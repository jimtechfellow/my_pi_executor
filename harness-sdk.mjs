#!/usr/bin/env node
// executor_harness — thin Pi-SDK host boundary for the Oracle Executor.
//
// Architecture: Codex Skill (any agent) -> this CLI -> Pi SDK persistent parent
// session -> pi-subagents -> Mission / Worker / HITL / strict-fork Reviewer.
//
// Hard rules (task contract):
//   - No daemon, no second task/recovery DB, no session registry, no recovery
//     state machine. The native Mission store is the ONLY durable source of
//     truth; everything is derived from it read-only.
//   - stdout is a single JSON document. All diagnostics/progress -> stderr.
//   - Free text enters via stdin or --*-file, never shell interpolation.
//   - Fail closed: if a safe continuation cannot be proven, report and exit 1.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import * as childProcess from "node:child_process";

const WORKSPACE_DEFAULT = "/home/ubuntu/cc-connect-workspace";
const SKILL_WORKFLOW = "/home/ubuntu/.agents/skills/executor/workflows/executor.js";
const SKILL_MD = "/home/ubuntu/.agents/skills/executor/SKILL.md";
const CC_CONFIG = "/home/ubuntu/.cc-connect/config.toml";
const BASELINE = {
  "pi": "0.84.2",
  "pi-subagents": "0.59.0",
  "pi-mcp-adapter": "2.31.0",
  "cc-connect": "1.5.0",
  "codex": "0.149.1",
};

// ---------- tiny stdio helpers ----------
const jstderr = (obj) => process.stderr.write(JSON.stringify(obj) + "\n");
const progress = (msg) => process.stderr.write(String(msg) + "\n");
function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + "\n"); }
function die(obj, code = 1) { out(obj); process.exit(code); }
function readStdin() {
  if (process.stdin.isTTY) return null;
  try { return fs.readFileSync(0, "utf8"); } catch { return null; }
}

// ---------- mission store (read-only; the sole durable source of truth) ----------
function agentDir() { return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"); }
function projectHash(root) { return crypto.createHash("sha256").update(root).digest("hex"); }
function missionDir(workspace) { return path.join(agentDir(), "missions", "projects", projectHash(workspace)); }
function listMissions(workspace) {
  const dir = missionDir(workspace);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
  return files
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
function getMission(workspace, id) { return listMissions(workspace).find((m) => m.id === id) || null; }
function openDecisions(m) { return (m.decisions || []).filter((d) => d.status === "open"); }
function missionFacts(m) {
  return {
    missionId: m.id, title: m.title, status: m.status,
    createdAt: m.createdAt, updatedAt: m.updatedAt,
    ownerSessionId: m.ownerSessionId,
    decisions: (m.decisions || []).map((d) => ({ id: d.id, title: d.title, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt })),
    workflowChildren: (m.workflowChildren || []).map((c) => ({ key: c.key, agent: c.agent, status: c.status, runId: c.runId || null, sessionPath: c.sessionPath })),
    runs: (m.runs || []).map((r) => ({ runId: r.runId, status: r.status, asyncDir: r.asyncDir })),
    summary: String(m.summary || "").slice(0, 400),
  };
}

// ---------- toml-lite field reader (read-only, for GLM route check) ----------
function tomlField(text, key) {
  const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]+)"', "m"));
  return m ? m[1] : null;
}

// ---------- SDK ----------
async function loadSdk() {
  const mod = await import("@earendil-works/pi-coding-agent");
  return mod;
}

function lastAssistantText(session) {
  const msgs = session.messages || (session.agent && session.agent.state && session.agent.state.messages) || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === "assistant") {
      const c = m.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.filter((p) => p && p.type === "text").map((p) => p.text).join("\n");
    }
  }
  return "";
}
function parseHarnessReport(text) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("HARNESS_REPORT:")) {
      try { return JSON.parse(lines[i].slice("HARNESS_REPORT:".length)); } catch { return null; }
    }
  }
  return null;
}
function attachProgress(session, tag) {
  return session.subscribe((ev) => {
    try {
      if (ev.type === "message_update" && ev.assistantMessageEvent && ev.assistantMessageEvent.type === "text_delta") {
        process.stderr.write(ev.assistantMessageEvent.delta);
      } else if (ev.type === "tool_execution_start") {
        progress(`[${tag}] tool: ${ev.toolName || ev.name || "?"}`);
      } else if (ev.type === "error") {
        jstderr({ tag, event: "error", message: String(ev.message || ev).slice(0, 300) });
      }
    } catch { /* progress must never break the run */ }
  });
}

// ---------- parent prompts (Executor Skill orchestration contract) ----------
function runPrompt({ title, goal, acceptance, workspace, waitfor, markerDir }) {
  const accept = acceptance.map((a) => "- " + a).join("\n");
  const waitRule = waitfor === "completion"
    ? [
        "3. Wait for the workflow to COMPLETE (subagent_wait). Do not create any Mission decision; the task must not require a user decision.",
        "4. After completion, verify the Mission reached terminal state with the strict-fork reviewer executed (review-1 child present).",
      ].join("\n")
    : [
        "3. Wait until the worker reaches contact_supervisor(reason:\"need_decision\") (subagent_wait).",
        "4. Persist EXACTLY ONE open decision on the SAME Mission via subagent({action:\"mission.update\", missionId, missionUpdate:{decisions:[{title, prompt:<the worker's question>}]}}) and capture the generated decision id. Never create a second decision.",
      ].join("\n");
  return [
    "You are the parent orchestrator of the Executor Skill (executor, v2.0.0). Follow its orchestration contract exactly. This session is driven non-interactively by executor_harness; there is no interactive user. Diagnose-before-delegation is waived: the task below is self-contained.",
    "",
    "TASK TITLE: " + title,
    "GOAL: " + goal,
    "ACCEPTANCE CONTRACT:",
    accept,
    "WORKSPACE: " + workspace,
    "SIDE-EFFECT RULE: write only inside " + markerDir + " (create it if missing). Never touch production files under /home/ubuntu/cc-connect-workspace or any config.",
    "Do NOT create a SPEC.md. Do NOT build a second task/checkpoint database.",
    "",
    "Execute now, in this single turn:",
    "1. Create the durable Mission first: subagent({action:\"mission.create\", mission:{title:<title>, objective:<goal + acceptance + side-effect rule>}}) and capture missionId.",
    "2. Launch the workflow async and bound to that Mission: subagent({workflowScriptPath:" + JSON.stringify(SKILL_WORKFLOW) + ", missionId, cwd:" + JSON.stringify(workspace) + ", async:true}).",
    waitRule,
    "5. End your turn with EXACTLY ONE final line of the form (nothing after it):",
    'HARNESS_REPORT:{"missionId":"...","decisionId":"..." or null,"workflowRunId":"...","childRunIds":[...],"missionStatus":"needs_decision" or "completed" or "failed","sessionFile":"' + "<your session file>" + '"}',
    waitfor === "completion" ? "Do not create any decision." : "Do NOT resolve the decision and do NOT run the reviewer in this turn; end the turn right after persisting the decision.",
    "If any step cannot be proven safe, fail closed: report HARNESS_REPORT with missionStatus:\"failed\" and a one-line reason.",
  ].join("\n");
}

function answerPrompt({ missionId, decisionId, question, answer, workspace }) {
  return [
    "You are the SAME parent orchestrator of the Executor Skill (executor, v2.0.0), continuing Mission " + missionId + " in this SAME session. The user has now answered the open decision.",
    "",
    "OPEN DECISION id: " + decisionId,
    "ORIGINAL QUESTION: " + question,
    "USER ANSWER: " + answer,
    "",
    "Follow Executor Skill step 6 exactly, in this single turn:",
    "1. Resolve the SAME decision id (never a new one): subagent({action:\"mission.resolve-decision\", missionId:" + JSON.stringify(missionId) + ", id:" + JSON.stringify(decisionId) + ", summary:<the user answer>}).",
    "2. Deliver the answer to the waiting worker:",
    "   a. If the original supervisor route is still live, reply natively (subagent_supervisor reply/pending).",
    "   b. Otherwise resume the retained child ONLY if Mission/retained-child status explicitly proves resumable (subagent({action:\"resume\", id:<retained child run id>})). Never guess resumability; never re-run a completed step; never create a replacement Mission. If not provable, fail closed.",
    "3. Continue the SAME Mission lineage until the post-decision workflow step and the strict-fork Reviewer actually run (subagent_wait).",
    "4. End your turn with EXACTLY ONE final line:",
    'HARNESS_REPORT:{"missionId":"' + missionId + '","decisionId":"' + decisionId + '","missionStatus":"completed"|"failed","reviewRounds":<n>,"final":"<one-line verdict>"}',
    "If the upstream error 'This extension ctx is stale after session replacement or reload' appears, STOP immediately and report HARNESS_REPORT with missionStatus:\"failed\" and the exact error text.",
  ].join("\n");
}

// ---------- commands ----------
async function cmdDoctor(args) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

  // 1. Pi SDK load
  let sdk = null;
  try {
    sdk = await loadSdk();
    const pkg = JSON.parse(fs.readFileSync(new URL("./node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"));
    add("pi_sdk_load", pkg.version === BASELINE.pi, `pi ${pkg.version} (baseline ${BASELINE.pi})`);
    const need = ["createAgentSession", "createAgentSessionRuntime", "AgentSessionRuntime", "SessionManager", "DefaultResourceLoader", "createAgentSessionServices"];
    const missing = need.filter((s) => !(s in sdk));
    add("pi_sdk_exports", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : "all required exports present");
  } catch (e) { add("pi_sdk_load", false, String(e).slice(0, 200)); }

  // 2. pi-subagents load (static + dynamic)
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir(), "settings.json"), "utf8"));
    const pkgs = (settings.packages || []).join(",");
    const staticOk = pkgs.includes(`npm:pi-subagents@${BASELINE["pi-subagents"]}`);
    const ver = JSON.parse(fs.readFileSync(path.join(agentDir(), "npm/node_modules/pi-subagents/package.json"), "utf8")).version;
    add("pi_subagents_load_static", staticOk && ver === BASELINE["pi-subagents"], `settings:${pkgs} | installed:${ver}`);
  } catch (e) { add("pi_subagents_load_static", false, String(e).slice(0, 200)); }

  const workspace = args.workspace || WORKSPACE_DEFAULT;
  try {
    const services = await sdk.createAgentSessionServices({ cwd: workspace });
    const exts = await services.resourceLoader.getExtensions();
    const errs = (exts.errors || []).map(String);
    const hasSubagents = (exts.extensions || []).some((x) => String(x.sourceInfo && x.sourceInfo.source || "").includes("pi-subagents"));
    const hasRecovery = (exts.extensions || []).some((x) => (x.resolvedPath || "").endsWith("executor-recovery.ts"));
    add("pi_subagents_load_dynamic", hasSubagents && errs.length === 0, `pi-subagents registered: ${hasSubagents}; ext errors: ${errs.length}${errs.length ? " -> " + errs[0].slice(0, 120) : ""}`);
    add("executor_recovery_extension", hasRecovery, hasRecovery ? "project executor-recovery.ts discovered" : "not discovered");
    const skills = await services.resourceLoader.getSkills();
    const exec = (skills.skills || []).find((s) => s.name === "executor");
    const skillDiags = (skills.skillDiagnostics || []).length;
    let ver = null;
    if (exec && fs.existsSync(exec.filePath)) {
      const fm = fs.readFileSync(exec.filePath, "utf8");
      ver = (fm.match(/^version:\s*(\S+)/m) || [])[1] || null;
    }
    add("executor_skill_discovered", !!exec && skillDiags === 0, `name=executor v${ver} (${exec ? exec.filePath : "not found"}); skillDiagnostics=${skillDiags}`);
  } catch (e) { add("extensions_dynamic", false, String(e).slice(0, 200)); }

  // 3. Mission store readable
  try {
    const ms = listMissions(workspace);
    const nonTerm = ms.filter((m) => !["completed", "failed", "cancelled"].includes(m.status));
    add("mission_store_readable", true, `${missionDir(workspace)} | ${ms.length} missions, ${nonTerm.length} non-terminal`);
  } catch (e) { add("mission_store_readable", false, String(e).slice(0, 200)); }

  // 4. GLM route untouched + no OpenAI + zero upgrade
  try {
    const cfg = fs.readFileSync(CC_CONFIG, "utf8");
    const type = tomlField(cfg, "type"), model = tomlField(cfg, "model");
    add("glm_route_untouched", type === "pi" && model === "zai/glm-5.3", `cc-connect agent.type=${type} model=${model}`);
  } catch (e) { add("glm_route_untouched", false, String(e).slice(0, 200)); }
  add("no_openai_api_key", !process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY ? "OPENAI_API_KEY present!" : "OPENAI_API_KEY absent");
  try {
    const piPkg = JSON.parse(fs.readFileSync(path.join(agentDir(), "npm/node_modules/pi-subagents/package.json"), "utf8"));
    const exec0 = (cmd) => { try { return childProcess.execSync(cmd, { encoding: "utf8", timeout: 15000 }).split(/\r?\n/)[0].trim(); } catch (e) { return "err:" + String(e).slice(0, 60); } };
    const cc = exec0("cc-connect --version"), cx = exec0("codex --version");
    add("zero_dependency_upgrade", piPkg.version === BASELINE["pi-subagents"] && cc.includes(BASELINE["cc-connect"]) && cx.includes(BASELINE.codex), `cc-connect:${cc} codex:${cx} pi-subagents:${piPkg.version}`);
  } catch (e) { add("zero_dependency_upgrade", false, String(e).slice(0, 200)); }

  // 5. SDK session smoke (in-memory, no prompt -> no model call)
  try {
    const { session } = await sdk.createAgentSession({ sessionManager: sdk.SessionManager.inMemory() });
    const mid = session.sessionId, sf = session.sessionFile;
    session.dispose();
    add("sdk_session_smoke", !!mid && sf === undefined, `in-memory session ${String(mid).slice(0, 8)}… created+disposed, no persistence`);
  } catch (e) { add("sdk_session_smoke", false, String(e).slice(0, 200)); }

  const failed = checks.filter((c) => !c.pass);
  out({ cmd: "doctor", overall: failed.length === 0 ? "PASS" : "FAIL", checks, ts: new Date().toISOString() });
  process.exit(failed.length === 0 ? 0 : 1);
}

async function cmdRun(args) {
  const workspace = args.workspace || WORKSPACE_DEFAULT;
  const waitfor = args["wait-for"] === "completion" ? "completion" : "decision";
  const markerDir = args["marker-dir"] || "/tmp/oracle-executor/markers/default";
  let input = null;
  if (args["goal-file"]) input = JSON.parse(fs.readFileSync(args["goal-file"], "utf8"));
  else { const raw = readStdin(); input = raw ? JSON.parse(raw) : null; }
  if (!input || !input.goal || !Array.isArray(input.acceptance) || !input.title) die({ cmd: "run", error: "need JSON {title, goal, acceptance[]} via stdin or --goal-file" });

  const sdk = await loadSdk();
  progress(`[run] creating persistent parent session (cwd=${workspace})`);
  const { session } = await sdk.createAgentSession({ sessionManager: sdk.SessionManager.create(workspace) });
  const sessionPath = session.sessionFile, sessionId = session.sessionId;
  const model = session.model ? (session.model.id || session.model.model || String(session.model)) : null;
  attachProgress(session, "run");
  jstderr({ tag: "run", sessionPath, sessionId, model, waitfor });

  const prompt = runPrompt({ ...input, workspace, waitfor, markerDir });
  await session.prompt(prompt); // resolves when the parent turn ends
  const report = parseHarnessReport(lastAssistantText(session));
  session.dispose();

  // Cross-check against the native Mission store (sole source of truth)
  const m = report && report.missionId ? getMission(workspace, report.missionId) : null;
  const facts = m ? missionFacts(m) : null;
  const checks = [];
  checks.push({ name: "harness_report_present", pass: !!report });
  checks.push({ name: "mission_exists_in_store", pass: !!m });
  if (m) {
    checks.push({ name: "mission_owned_by_parent_session", pass: m.ownerSessionId === sessionPath, detail: `${m.ownerSessionId}` });
    if (waitfor === "decision") {
      const od = openDecisions(m);
      checks.push({ name: "exactly_one_open_decision", pass: od.length === 1, detail: `${od.length} open` });
      checks.push({ name: "mission_needs_decision", pass: m.status === "needs_decision", detail: m.status });
      if (report && report.decisionId && od[0] && report.decisionId !== od[0].id) checks.push({ name: "decision_id_match", pass: false, detail: `${report.decisionId} vs ${od[0].id}` });
    } else {
      checks.push({ name: "mission_completed", pass: m.status === "completed", detail: m.status });
      checks.push({ name: "reviewer_ran", pass: (m.workflowChildren || []).some((c) => /^review-/.test(c.key)), detail: (m.workflowChildren || []).map((c) => c.key + ":" + c.status).join(",") });
    }
  }
  const failed = checks.filter((c) => !c.pass);
  out({
    cmd: "run", overall: failed.length === 0 ? "PASS" : "FAIL",
    missionId: m ? m.id : null, decisionId: (m && openDecisions(m)[0] ? openDecisions(m)[0].id : (report ? report.decisionId : null)),
    sessionPath, sessionId, model, waitfor, report, mission: facts, checks,
    ts: new Date().toISOString(),
  });
  process.exit(failed.length === 0 ? 0 : 1);
}

async function cmdStatus(args) {
  const workspace = args.workspace || WORKSPACE_DEFAULT;
  let ms = listMissions(workspace);
  if (args.mission) ms = ms.filter((m) => m.id === args.mission);
  const rows = ms.slice(-10).map((m) => {
    const facts = missionFacts(m);
    // enrich with async run dir liveness (read-only)
    facts.runState = (m.runs || []).map((r) => {
      if (!r.asyncDir) return { runId: r.runId, asyncState: null };
      try {
        const st = JSON.parse(fs.readFileSync(path.join(r.asyncDir, "status.json"), "utf8"));
        return { runId: r.runId, asyncState: st.state, endedAt: st.endedAt || null, workflowState: st.workflowChildren && st.workflowChildren.workflowState, receipt: fs.existsSync(path.join(r.asyncDir, "workflow-receipt.json")) };
      } catch { return { runId: r.runId, asyncState: "no-status-file" }; }
    });
    return facts;
  });
  out({ cmd: "status", workspace, count: ms.length, missions: rows, ts: new Date().toISOString() });
}

async function cmdAnswer(args) {
  const workspace = args.workspace || WORKSPACE_DEFAULT;
  if (!args.mission) die({ cmd: "answer", error: "--mission required" });
  let answer = null, question = null;
  if (args["answer-file"]) { const j = JSON.parse(fs.readFileSync(args["answer-file"], "utf8")); answer = j.answer; question = j.question || null; }
  else { const raw = readStdin(); if (raw) { const j = JSON.parse(raw); answer = j.answer; question = j.question || null; } }
  if (!answer) die({ cmd: "answer", error: 'need JSON {answer, question?} via stdin or --answer-file' });

  const m0 = getMission(workspace, args.mission);
  if (!m0) die({ cmd: "answer", error: "mission not found in store" });
  const od = openDecisions(m0);
  if (od.length !== 1) die({ cmd: "answer", error: `expected exactly one open decision, found ${od.length}`, mission: missionFacts(m0) });
  const decisionId = od[0].id;
  const sessionPath = m0.ownerSessionId;
  if (!sessionPath || !fs.existsSync(sessionPath)) die({ cmd: "answer", error: "owner parent session file missing", ownerSessionId: sessionPath });

  const sdk = await loadSdk();
  progress(`[answer] opening SAME parent session ${sessionPath}`);
  const { session } = await sdk.createAgentSession({ sessionManager: sdk.SessionManager.open(sessionPath) });
  attachProgress(session, "answer");
  jstderr({ tag: "answer", sessionPath, sessionId: session.sessionId, sameSession: session.sessionFile === sessionPath });

  // followUp: the project executor-recovery extension may inject a recovery user
  // turn on open; queue our answer behind it instead of colliding mid-stream.
  await session.prompt(answerPrompt({ missionId: args.mission, decisionId, question: question || od[0].prompt || od[0].title, answer, workspace }), { streamingBehavior: "followUp" });
  const report = parseHarnessReport(lastAssistantText(session));
  session.dispose();

  const m = getMission(workspace, args.mission);
  const facts = m ? missionFacts(m) : null;
  const checks = [
    { name: "harness_report_present", pass: !!report },
    { name: "same_mission", pass: !!m && m.id === args.mission },
    { name: "decision_resolved_same_id", pass: !!m && (m.decisions || []).some((d) => d.id === decisionId && d.status === "resolved") },
    { name: "no_new_decisions", pass: !!m && (m.decisions || []).length === (m0.decisions || []).length },
    { name: "mission_terminal_completed", pass: !!m && m.status === "completed" },
    { name: "reviewer_ran_after_decision", pass: !!m && (m.workflowChildren || []).some((c) => /^review-/.test(c.key)) },
    { name: "no_stale_ctx_error", pass: !(report && /stale after session replacement/i.test(JSON.stringify(report))) },
  ];
  const failed = checks.filter((c) => !c.pass);
  out({ cmd: "answer", overall: failed.length === 0 ? "PASS" : "FAIL", missionId: args.mission, decisionId, sessionPath, report, mission: facts, checks, ts: new Date().toISOString() });
  process.exit(failed.length === 0 ? 0 : 1);
}

async function cmdRecover(args) {
  const workspace = args.workspace || WORKSPACE_DEFAULT;
  const ms = listMissions(workspace).filter((m) => !["completed", "failed", "cancelled"].includes(m.status));
  const plan = ms.map((m) => {
    const od = openDecisions(m);
    const liveChildren = (m.workflowChildren || []).filter((c) => !["completed", "failed", "cancelled"].includes(c.status));
    let action, note;
    if (od.length === 1 && m.status === "needs_decision") { action = "re-present-decision"; note = `decisionId=${od[0].id}; open SAME parent session ${m.ownerSessionId} and follow skill step 6 after the user answers`; }
    else if (od.length > 1) { action = "fail-closed"; note = "multiple open decisions — not provable safe"; }
    else if (liveChildren.length > 0) { action = "native-resume-if-proven-resumable"; note = `children: ${liveChildren.map((c) => c.key + ":" + c.status).join(",")}; resume ONLY on explicit retained/resumable status`; }
    else { action = "fail-closed"; note = "no open decision and no provable next step"; }
    return { missionId: m.id, title: m.title, status: m.status, action, note, mission: missionFacts(m) };
  });
  out({ cmd: "recover", workspace, recoverable: plan.length, plan, note: "diagnostic only; nothing executed. Continuation must go through the SAME parent session + native tools.", ts: new Date().toISOString() });
}

// ---------- arg parsing ----------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); args[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  if (cmd === "doctor") await cmdDoctor(args);
  else if (cmd === "run") await cmdRun(args);
  else if (cmd === "status") await cmdStatus(args);
  else if (cmd === "answer") await cmdAnswer(args);
  else if (cmd === "recover") await cmdRecover(args);
  else {
    out({ cmd: cmd || null, error: "usage: harness.mjs <doctor|run|status|answer|recover> [flags]", flags: ["--workspace <dir>", "--goal-file <json>", "--answer-file <json>", "--mission <id>", "--wait-for decision|completion", "--marker-dir <dir>"] });
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  die({ cmd, error: String((e && e.stack) || e).slice(0, 800) });
}
