#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PiRpc } from './pi_rpc.mjs';
import { getMission, listMissions, missionFacts, openDecisions, isTerminal } from './mission_store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const DEFAULT_WORKSPACE = process.env.EXECUTOR_WORKSPACE || process.cwd();
const DEFAULT_MODEL = process.env.EXECUTOR_MODEL || 'deepseek/deepseek-v4-pro';
const DEFAULT_THINKING = process.env.EXECUTOR_THINKING || 'medium';
const DEFAULT_SESSION_DIR = process.env.EXECUTOR_SESSION_DIR || path.join(os.homedir(), '.pi', 'agent', 'sessions', 'executor');

function die(message, code = 1) {
  process.stderr.write(`executor: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { args._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function readJsonInput(file) {
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.stdin.isTTY) return null;
  const text = fs.readFileSync(0, 'utf8').trim();
  return text ? JSON.parse(text) : null;
}

function taskPrompt({ title, goal, acceptance, workspace }) {
  return [
    `Use the executor Skill at ${SKILL_MD}.`,
    'This is an authorized state-changing engineering/operations task. Follow that Skill as the sole Executor authority; do not invent a second workflow.',
    `TITLE: ${title}`,
    `GOAL: ${goal}`,
    'ACCEPTANCE:',
    ...acceptance.map((x) => `- ${x}`),
    `WORKSPACE: ${workspace}`,
    'Execute now. Preserve the Skill\'s Mission/HITL/review contract. Return the Skill\'s normal compact result.',
  ].join('\n');
}

function answerPrompt({ missionId, decisionId, answer }) {
  return [
    `Use the executor Skill at ${SKILL_MD}.`,
    `Continue the SAME Mission ${missionId} in the resumed parent session.`,
    `The user answered the existing open decision ${decisionId}: ${answer}`,
    'Follow the Skill\'s HITL continuation contract. Do not create a replacement Mission or duplicate a completed step.',
  ].join('\n');
}

function recoverPrompt({ missionId }) {
  return [
    `Use the executor Skill at ${SKILL_MD}.`,
    `Recover the SAME non-terminal Mission ${missionId} in its original parent session.`,
    'Use native Mission/run state only. Resume only a step that is provably resumable; never create a replacement Mission or re-run a completed side effect. Fail closed if the next action is ambiguous.',
  ].join('\n');
}

async function runTurn({ workspace, session = null, prompt, timeoutMs = 15 * 60 * 1000, name }) {
  fs.mkdirSync(DEFAULT_SESSION_DIR, { recursive: true });
  const rpc = new PiRpc({ cwd: workspace, model: DEFAULT_MODEL, thinking: DEFAULT_THINKING, sessionDir: DEFAULT_SESSION_DIR, session, name });
  rpc.on('stderr', (s) => process.stderr.write(s));
  rpc.start();
  try {
    const state = await rpc.initialize();
    const settled = rpc.waitEvent('agent_settled', timeoutMs);
    const response = await rpc.prompt(prompt);
    if (!response?.success) throw new Error(response?.error || 'prompt rejected');
    await settled;
    const last = await rpc.getLastAssistantText();
    return {
      sessionId: state.sessionId || rpc.sessionId,
      sessionFile: state.sessionFile || rpc.sessionFile,
      text: last?.data?.text || '',
    };
  } finally {
    rpc.stop();
  }
}

function chooseNewMission(beforeIds, after, sessionFile) {
  const created = after.filter((m) => !beforeIds.has(m.id));
  const owned = created.filter((m) => !sessionFile || m.ownerSessionId === sessionFile);
  if (owned.length === 1) return owned[0];
  if (created.length === 1) return created[0];
  throw new Error(`expected exactly one new Mission, created=${created.length}, owned=${owned.length}`);
}

async function commandRun(args) {
  const input = readJsonInput(args['goal-file']);
  if (!input?.title || !input?.goal || !Array.isArray(input.acceptance)) die('run needs JSON {title, goal, acceptance[]} via stdin or --goal-file', 2);
  const workspace = path.resolve(args.workspace || input.workspace || DEFAULT_WORKSPACE);
  const beforeIds = new Set(listMissions(workspace).map((m) => m.id));
  const turn = await runTurn({ workspace, prompt: taskPrompt({ ...input, workspace }), name: `executor-${Date.now()}` });
  const mission = chooseNewMission(beforeIds, listMissions(workspace), turn.sessionFile);
  process.stdout.write(JSON.stringify({ overall: isTerminal(mission) ? (mission.status === 'completed' ? 'PASS' : 'FAILED') : mission.status === 'needs_decision' ? 'NEEDS_DECISION' : 'RUNNING', sessionId: turn.sessionId, sessionFile: turn.sessionFile, mission: missionFacts(mission), final: turn.text }, null, 2) + '\n');
}

async function commandAnswer(args) {
  const input = readJsonInput(args['answer-file']);
  const missionId = args.mission;
  if (!missionId || !input?.answer) die('answer needs --mission <id> and JSON {answer} via stdin or --answer-file', 2);
  const workspace = path.resolve(args.workspace || DEFAULT_WORKSPACE);
  const before = getMission(workspace, missionId);
  if (!before) die('mission not found', 3);
  const decisions = openDecisions(before);
  if (decisions.length !== 1) die(`expected exactly one open decision, found ${decisions.length}`, 3);
  if (!before.ownerSessionId) die('mission has no ownerSessionId; cannot prove parent session', 3);
  const turn = await runTurn({ workspace, session: before.ownerSessionId, prompt: answerPrompt({ missionId, decisionId: decisions[0].id, answer: input.answer }), name: `executor-resume-${missionId}` });
  const after = getMission(workspace, missionId);
  if (!after) die('mission disappeared after resume', 4);
  const stillOpen = openDecisions(after);
  const status = after.status === 'completed' ? 'PASS' : after.status === 'needs_decision' && stillOpen.length === 1 ? 'NEEDS_DECISION' : isTerminal(after) ? 'FAILED' : 'RUNNING';
  process.stdout.write(JSON.stringify({ overall: status, sessionId: turn.sessionId, sessionFile: turn.sessionFile, mission: missionFacts(after), final: turn.text }, null, 2) + '\n');
}

async function commandRecover(args) {
  const missionId = args.mission;
  if (!missionId) die('recover needs --mission <id>', 2);
  const workspace = path.resolve(args.workspace || DEFAULT_WORKSPACE);
  const before = getMission(workspace, missionId);
  if (!before) die('mission not found', 3);
  if (isTerminal(before)) {
    process.stdout.write(JSON.stringify({ overall: 'NOOP', reason: 'terminal', mission: missionFacts(before) }, null, 2) + '\n');
    return;
  }
  const decisions = openDecisions(before);
  if (decisions.length === 1 && before.status === 'needs_decision') {
    process.stdout.write(JSON.stringify({ overall: 'NEEDS_DECISION', reason: 'existing_open_decision', mission: missionFacts(before) }, null, 2) + '\n');
    return;
  }
  if (decisions.length > 0) die(`unsafe recovery: ${decisions.length} open decisions`, 3);
  if (!before.ownerSessionId) die('mission has no ownerSessionId; cannot prove parent session', 3);
  const turn = await runTurn({ workspace, session: before.ownerSessionId, prompt: recoverPrompt({ missionId }), name: `executor-recover-${missionId}` });
  const after = getMission(workspace, missionId);
  process.stdout.write(JSON.stringify({ overall: after?.status === 'completed' ? 'PASS' : after?.status === 'needs_decision' ? 'NEEDS_DECISION' : isTerminal(after) ? 'FAILED' : 'RUNNING', sessionId: turn.sessionId, sessionFile: turn.sessionFile, mission: missionFacts(after), final: turn.text }, null, 2) + '\n');
}

function commandStatus(args) {
  const workspace = path.resolve(args.workspace || DEFAULT_WORKSPACE);
  const missions = args.mission ? [getMission(workspace, args.mission)].filter(Boolean) : listMissions(workspace).slice(-20);
  process.stdout.write(JSON.stringify({ workspace, missions: missions.map(missionFacts) }, null, 2) + '\n');
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
try {
  if (command === 'run') await commandRun(args);
  else if (command === 'answer') await commandAnswer(args);
  else if (command === 'recover') await commandRecover(args);
  else if (command === 'status') commandStatus(args);
  else die('usage: runtime.mjs <run|answer|recover|status> [--workspace PATH --mission ID --goal-file FILE --answer-file FILE]', 2);
} catch (error) {
  die(error?.stack || error?.message || String(error));
}
