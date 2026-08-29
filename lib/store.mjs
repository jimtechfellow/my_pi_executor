// Read-only access to the native Mission store (the sole durable source of truth).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function agentDir() { return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"); }
export function projectHash(root) { return crypto.createHash("sha256").update(root).digest("hex"); }
export function missionDir(workspace) { return path.join(agentDir(), "missions", "projects", projectHash(workspace)); }
export function listMissions(workspace) {
  const dir = missionDir(workspace);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; }
  return files
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
export function getMission(workspace, id) { return listMissions(workspace).find((m) => m.id === id) || null; }
export function openDecisions(m) { return (m.decisions || []).filter((d) => d.status === "open"); }
export function missionFacts(m) {
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
export function tomlField(text, key) {
  const m = text.match(new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]+)"', "m"));
  return m ? m[1] : null;
}
export function runState(m) {
  return (m.runs || []).map((r) => {
    if (!r.asyncDir) return { runId: r.runId, asyncState: null };
    try {
      const st = JSON.parse(fs.readFileSync(path.join(r.asyncDir, "status.json"), "utf8"));
      return { runId: r.runId, asyncState: st.state, endedAt: st.endedAt || null, workflowState: st.workflowChildren && st.workflowChildren.workflowState, receipt: fs.existsSync(path.join(r.asyncDir, "workflow-receipt.json")) };
    } catch { return { runId: r.runId, asyncState: "no-status-file" }; }
  });
}
