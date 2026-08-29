#!/usr/bin/env node
// executor_harness_host — thin persistent host.
// Owns a long-lived `pi --mode rpc` parent session + a 0600 unix socket.
// The CLI is a thin client; host + pi RPC stay alive across CLI commands.
// Mission store remains the ONLY durable source of truth; this host keeps only
// in-memory live routing (no durable registry, no second DB, no daemon runtime).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import * as childProcess from "node:child_process";
import { WORKSPACE_DEFAULT, SKILL_MD, CC_CONFIG, BASELINE, socketPath, MODEL } from "./lib/const.mjs";
import { agentDir, listMissions, getMission, openDecisions, missionFacts, tomlField, runState } from "./lib/store.mjs";
import { runPrompt, answerPrompt } from "./lib/prompts.mjs";
import { PiRpc } from "./lib/rpc.mjs";

const WORKSPACE = WORKSPACE_DEFAULT;

function parseHarnessReport(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("HARNESS_REPORT:")) {
      try { return JSON.parse(lines[i].slice("HARNESS_REPORT:".length)); } catch { return null; }
    }
  }
  return null;
}

class Host {
  constructor() {
    this.rpc = new PiRpc({ cwd: WORKSPACE });
    this.busy = false;
    this.ready = false;
    this.active = { missionId: null, decisionId: null }; // in-memory live routing only
    this.socketPath = socketPath();
    this.server = null;
    this.hostPid = process.pid;
  }

  log(msg) { process.stderr.write(`[host] ${msg}\n`); }

  async start() {
    this.rpc.start();
    this.log(`spawned pi --mode rpc pid=${this.rpc.pid} model=${MODEL}`);
    this.rpc.on("agent_start", () => { this.busy = true; });
    this.rpc.on("agent_settled", () => { this.busy = false; });
    this.rpc.on("extension_error", (e) => this.log(`extension_error: ${JSON.stringify(e).slice(0, 300)}`));
    this.rpc.on("stderr", (d) => process.stderr.write(`[pi-stderr] ${d}`));
    this.rpc.on("exit", (info) => this.log(`PI RPC EXITED: ${JSON.stringify(info)}`));

    // capture session identity from the live parent
    const st = await this.rpc.getState();
    if (st.success && st.data) {
      this.rpc.model = st.data.model || null;
      this.rpc.sessionId = st.data.sessionId;
      this.rpc.sessionFile = st.data.sessionFile;
      this.ready = true;
      this.log(`parent session=${this.rpc.sessionId} file=${this.rpc.sessionFile} model=${st.data.model ? st.data.model.id : "?"}`);
    } else {
      this.log(`get_state failed: ${JSON.stringify(st).slice(0, 200)}`);
    }

    await this.listen();
  }

  listen() {
    return new Promise((resolve, reject) => {
      try { fs.mkdirSync(path.dirname(this.socketPath), { recursive: true }); } catch {}
      try { fs.rmSync(this.socketPath, { force: true }); } catch {}
      this.server = net.createServer((sock) => this.handle(sock));
      this.server.on("error", reject);
      this.server.listen(this.socketPath, () => {
        try { fs.chmodSync(this.socketPath, 0o600); } catch {}
        this.log(`listening ${this.socketPath} (0600)`);
        resolve();
      });
    });
  }

  handle(sock) {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let req;
        try { req = JSON.parse(line); } catch { this.respond(sock, { id: null, success: false, error: "bad request json" }); sock.end(); return; }
        this.dispatch(sock, req).then(() => sock.end()).catch((e) => { this.respond(sock, { id: req.id, success: false, error: String(e && e.message || e).slice(0, 500) }); sock.end(); });
      }
    });
    sock.on("error", () => {});
  }

  respond(sock, { id, success, data, error }) {
    sock.write(JSON.stringify({ id, type: "response", success: !!success, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}) }) + "\n");
  }
  progress(sock, id, event) {
    sock.write(JSON.stringify({ id, type: "progress", event }) + "\n");
  }

  async dispatch(sock, req) {
    const { cmd, payload = {} } = req;
    try {
      switch (cmd) {
        case "ping": return this.respond(sock, { id: req.id, success: true, data: this.pingData() });
        case "doctor": return this.respond(sock, { id: req.id, success: true, data: await this.doctor() });
        case "run": return this.respond(sock, { id: req.id, success: true, data: await this.doRun(payload, (e) => this.progress(sock, req.id, e)) });
        case "status": return this.respond(sock, { id: req.id, success: true, data: await this.doStatus(payload) });
        case "answer": return this.respond(sock, { id: req.id, success: true, data: await this.doAnswer(payload, (e) => this.progress(sock, req.id, e)) });
        case "recover": return this.respond(sock, { id: req.id, success: true, data: await this.doRecover(payload) });
        case "shutdown": this.respond(sock, { id: req.id, success: true, data: { shuttingDown: true } }); setTimeout(() => { this.rpc.stop(); process.exit(0); }, 100); return;
        default: return this.respond(sock, { id: req.id, success: false, error: `unknown cmd ${cmd}` });
      }
    } catch (e) {
      return this.respond(sock, { id: req.id, success: false, error: String(e && e.stack || e).slice(0, 800) });
    }
  }

  pingData() {
    return {
      hostPid: this.hostPid,
      piPid: this.rpc.pid,
      piAlive: !this.rpc.exited,
      busy: this.busy,
      sessionId: this.rpc.sessionId,
      sessionFile: this.rpc.sessionFile,
      model: this.rpc.model ? this.rpc.model.id : null,
      socketPath: this.socketPath,
    };
  }

  ensureAlive() { if (this.rpc.exited) throw new Error(`pi RPC not alive (${JSON.stringify(this.rpc.exitInfo)})`); }

  async runTurn(promptText, { timeoutMs = 600000, sink = () => {} } = {}) {
    this.ensureAlive();
    if (this.busy) await this.rpc.waitEvent("agent_settled", 20000).catch(() => { throw new Error("pi busy and did not settle"); });
    const onUpdate = (e) => { if (e.assistantMessageEvent && e.assistantMessageEvent.type === "text_delta") sink({ type: "text_delta", delta: e.assistantMessageEvent.delta }); };
    const onToolStart = (e) => sink({ type: "tool", name: e.toolName });
    const onToolEnd = (e) => sink({ type: "tool_end", name: e.toolName });
    this.rpc.on("message_update", onUpdate);
    this.rpc.on("tool_execution_start", onToolStart);
    this.rpc.on("tool_execution_end", onToolEnd);
    try {
      const settleP = this.rpc.waitEvent("agent_settled", timeoutMs);
      const resp = await this.rpc.prompt(promptText);
      if (!resp.success) throw new Error(resp.error || "prompt rejected");
      await settleP;
    } finally {
      this.rpc.off("message_update", onUpdate);
      this.rpc.off("tool_execution_start", onToolStart);
      this.rpc.off("tool_execution_end", onToolEnd);
    }
    const t = await this.rpc.getLastAssistantText();
    return (t && t.data && t.data.text) || "";
  }

  async doctor() {
    const checks = [];
    const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
    // 1. live pi RPC on the right model
    try { this.ensureAlive(); add("pi_rpc_alive", true, `pi pid=${this.rpc.pid} session=${this.rpc.sessionId}`); }
    catch (e) { add("pi_rpc_alive", false, String(e)); }
    try {
      const st = await this.rpc.getState();
      const m = st.data && st.data.model;
      add("host_model_route", !!m && m.provider === "deepseek" && m.id === "deepseek-v4-pro", `provider=${m && m.provider} id=${m && m.id}`);
    } catch (e) { add("host_model_route", false, String(e).slice(0, 120)); }
    // 2. pi-subagents static + dynamic (SDK services)
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(agentDir(), "settings.json"), "utf8"));
      const pkgs = (settings.packages || []).join(",");
      const ver = JSON.parse(fs.readFileSync(path.join(agentDir(), "npm/node_modules/pi-subagents/package.json"), "utf8")).version;
      add("pi_subagents_load_static", pkgs.includes(`npm:pi-subagents@${BASELINE["pi-subagents"]}`) && ver === BASELINE["pi-subagents"], `settings:${pkgs} installed:${ver}`);
    } catch (e) { add("pi_subagents_load_static", false, String(e).slice(0, 120)); }
    try {
      const sdk = await import("@earendil-works/pi-coding-agent");
      const services = await sdk.createAgentSessionServices({ cwd: WORKSPACE });
      const exts = await services.resourceLoader.getExtensions();
      const errs = (exts.errors || []).map(String);
      const hasSubagents = (exts.extensions || []).some((x) => String(x.sourceInfo && x.sourceInfo.source || "").includes("pi-subagents"));
      const hasRecovery = (exts.extensions || []).some((x) => (x.resolvedPath || "").endsWith("executor-recovery.ts"));
      add("pi_subagents_load_dynamic", hasSubagents && errs.length === 0, `registered=${hasSubagents} errors=${errs.length}`);
      add("executor_recovery_extension", hasRecovery, hasRecovery ? "discovered" : "missing");
      const skills = await services.resourceLoader.getSkills();
      const exec = (skills.skills || []).find((s) => s.name === "executor");
      add("executor_skill_discovered", !!exec && (skills.skillDiagnostics || []).length === 0, `executor v${(exec && fs.readFileSync(exec.filePath, "utf8").match(/^version:\s*(\S+)/m) || [])[1] || "?"}`);
    } catch (e) { add("extensions_dynamic", false, String(e).slice(0, 200)); }
    // 3. mission store
    try { const ms = listMissions(WORKSPACE); const nonTerm = ms.filter((m) => !["completed", "failed", "cancelled"].includes(m.status)); add("mission_store_readable", true, `${ms.length} missions, ${nonTerm.length} non-terminal`); }
    catch (e) { add("mission_store_readable", false, String(e).slice(0, 120)); }
    // 4. GLM route + no openai + zero upgrade
    try { const cfg = fs.readFileSync(CC_CONFIG, "utf8"); add("cc_connect_route_pi", tomlField(cfg, "type") === "pi", `cc-connect type=${tomlField(cfg, "type")} model=${tomlField(cfg, "model")}`); }
    catch (e) { add("cc_connect_route_pi", false, String(e).slice(0, 120)); }
    add("no_openai_api_key", !process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY ? "OPENAI_API_KEY present" : "absent");
    try {
      const exec0 = (c) => { try { return childProcess.execSync(c, { encoding: "utf8", timeout: 15000 }).split(/\r?\n/)[0].trim(); } catch (e) { return "err"; } };
      add("zero_dependency_upgrade", exec0("cc-connect --version").includes(BASELINE["cc-connect"]) && exec0("codex --version").includes(BASELINE.codex), `cc-connect:${exec0("cc-connect --version")} codex:${exec0("codex --version")}`);
    } catch (e) { add("zero_dependency_upgrade", false, String(e).slice(0, 120)); }
    const failed = checks.filter((c) => !c.pass);
    return { overall: failed.length === 0 ? "PASS" : "FAIL", checks, ts: new Date().toISOString() };
  }

  async doRun(payload, sink) {
    const workspace = payload.workspace || WORKSPACE;
    const waitfor = payload.waitfor === "completion" ? "completion" : "decision";
    const markerDir = payload.markerDir || "/tmp/oracle-executor/markers/default";
    if (!payload.title || !payload.goal || !Array.isArray(payload.acceptance)) throw new Error("run needs {title, goal, acceptance[]}");
    const text = runPrompt({ ...payload, workspace, waitfor, markerDir });
    const out = await this.runTurn(text, { sink });
    const report = parseHarnessReport(out);
    const m = report && report.missionId ? getMission(workspace, report.missionId) : null;
    const facts = m ? missionFacts(m) : null;
    const checks = [
      { name: "harness_report_present", pass: !!report },
      { name: "mission_exists_in_store", pass: !!m },
    ];
    if (m) {
      checks.push({ name: "mission_owned_by_parent_session", pass: m.ownerSessionId === this.rpc.sessionFile, detail: `${m.ownerSessionId}` });
      if (waitfor === "decision") {
        const od = openDecisions(m);
        checks.push({ name: "exactly_one_open_decision", pass: od.length === 1, detail: `${od.length} open` });
        checks.push({ name: "mission_needs_decision", pass: m.status === "needs_decision", detail: m.status });
      } else {
        checks.push({ name: "mission_completed", pass: m.status === "completed", detail: m.status });
        checks.push({ name: "reviewer_ran", pass: (m.workflowChildren || []).some((c) => /^review-/.test(c.key)), detail: (m.workflowChildren || []).map((c) => c.key + ":" + c.status).join(",") });
      }
    }
    const od = m ? openDecisions(m) : [];
    this.active = { missionId: m ? m.id : null, decisionId: od[0] ? od[0].id : (report ? report.decisionId : null) };
    const failed = checks.filter((c) => !c.pass);
    return {
      overall: failed.length === 0 ? "PASS" : "FAIL",
      missionId: m ? m.id : null,
      decisionId: this.active.decisionId,
      sessionId: this.rpc.sessionId,
      sessionFile: this.rpc.sessionFile,
      model: this.rpc.model ? this.rpc.model.id : null,
      waitfor, report, mission: facts, checks,
      ts: new Date().toISOString(),
    };
  }

  doStatus(payload) {
    const workspace = payload.workspace || WORKSPACE;
    let ms = listMissions(workspace);
    if (payload.mission) ms = ms.filter((m) => m.id === payload.mission);
    const rows = ms.slice(-10).map((m) => ({ ...missionFacts(m), runState: runState(m) }));
    return { workspace, count: ms.length, missions: rows, ts: new Date().toISOString() };
  }

  async doAnswer(payload, sink) {
    const workspace = payload.workspace || WORKSPACE;
    const missionId = payload.missionId;
    if (!missionId) throw new Error("answer needs missionId");
    const answer = payload.answer;
    if (!answer) throw new Error("answer needs answer text");
    const m0 = getMission(workspace, missionId);
    if (!m0) throw new Error("mission not found in store");
    const od = openDecisions(m0);
    if (od.length !== 1) throw new Error(`expected exactly one open decision, found ${od.length}`);
    const decisionId = od[0].id;
    const question = payload.question || od[0].prompt || od[0].title || "";
    const text = answerPrompt({ missionId, decisionId, question, answer });
    const out = await this.runTurn(text, { sink, timeoutMs: 900000 });
    const report = parseHarnessReport(out);
    const m = getMission(workspace, missionId);
    const facts = m ? missionFacts(m) : null;
    const checks = [
      { name: "harness_report_present", pass: !!report },
      { name: "same_mission", pass: !!m && m.id === missionId },
      { name: "decision_resolved_same_id", pass: !!m && (m.decisions || []).some((d) => d.id === decisionId && d.status === "resolved") },
      { name: "no_new_decisions", pass: !!m && (m.decisions || []).length === (m0.decisions || []).length },
      { name: "mission_terminal_completed", pass: !!m && m.status === "completed" },
      { name: "reviewer_ran_after_decision", pass: !!m && (m.workflowChildren || []).some((c) => /^review-/.test(c.key)) },
      { name: "no_stale_ctx_error", pass: !(report && /stale after session replacement/i.test(JSON.stringify(report))) },
    ];
    const failed = checks.filter((c) => !c.pass);
    this.active = { missionId, decisionId };
    return {
      overall: failed.length === 0 ? "PASS" : "FAIL",
      missionId, decisionId, sessionId: this.rpc.sessionId, sessionFile: this.rpc.sessionFile,
      report, mission: facts, checks, ts: new Date().toISOString(),
    };
  }

  doRecover(payload) {
    const workspace = payload.workspace || WORKSPACE;
    const ms = listMissions(workspace).filter((m) => !["completed", "failed", "cancelled"].includes(m.status));
    const plan = ms.map((m) => {
      const od = openDecisions(m);
      const liveChildren = (m.workflowChildren || []).filter((c) => !["completed", "failed", "cancelled"].includes(c.status));
      let action, note;
      if (od.length === 1 && m.status === "needs_decision") { action = "re-present-decision"; note = `decisionId=${od[0].id}; same parent session ${m.ownerSessionId}`; }
      else if (od.length > 1) { action = "fail-closed"; note = "multiple open decisions"; }
      else if (liveChildren.length > 0) { action = "native-resume-if-proven-resumable"; note = `children: ${liveChildren.map((c) => c.key + ":" + c.status).join(",")}`; }
      else { action = "fail-closed"; note = "no open decision and no provable next step"; }
      return { missionId: m.id, title: m.title, status: m.status, action, note };
    });
    return { workspace, recoverable: plan.length, plan, note: "diagnostic only; nothing executed", ts: new Date().toISOString() };
  }
}

const host = new Host();
await host.start();
function shutdown(code = 0) {
  host.rpc.stop();
  try { fs.rmSync(host.socketPath, { force: true }); } catch {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
