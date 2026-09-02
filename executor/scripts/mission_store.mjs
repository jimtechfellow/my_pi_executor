import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function agentDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
}

export function projectHash(root) {
  return crypto.createHash('sha256').update(root).digest('hex');
}

export function missionDir(workspace) {
  return path.join(agentDir(), 'missions', 'projects', projectHash(workspace));
}

export function listMissions(workspace) {
  let files = [];
  try { files = fs.readdirSync(missionDir(workspace)).filter((f) => f.endsWith('.json')); }
  catch { return []; }
  return files
    .map((file) => {
      try { return JSON.parse(fs.readFileSync(path.join(missionDir(workspace), file), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

export function getMission(workspace, id) {
  return listMissions(workspace).find((m) => m.id === id) || null;
}

export function openDecisions(mission) {
  return (mission?.decisions || []).filter((d) => d.status === 'open');
}

export function isTerminal(mission) {
  return TERMINAL.has(mission?.status);
}

export function missionFacts(m) {
  if (!m) return null;
  return {
    missionId: m.id,
    title: m.title,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    ownerSessionId: m.ownerSessionId,
    decisions: (m.decisions || []).map((d) => ({ id: d.id, title: d.title, prompt: d.prompt, status: d.status, createdAt: d.createdAt, resolvedAt: d.resolvedAt })),
    workflowChildren: (m.workflowChildren || []).map((c) => ({ key: c.key, agent: c.agent, status: c.status, runId: c.runId || null, sessionPath: c.sessionPath || null })),
    runs: (m.runs || []).map((r) => ({ runId: r.runId, status: r.status, asyncDir: r.asyncDir || null })),
    summary: String(m.summary || '').slice(0, 600),
  };
}
