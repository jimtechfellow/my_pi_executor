import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'scripts', 'entrypoint.mjs');

function run(args, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd: root,
      env: { ...process.env, MY_PI_EXECUTOR_DISABLE_BWS: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

function fakeSdk(tmp) {
  const file = path.join(tmp, 'fake-sdk.mjs');
  fs.writeFileSync(file, `
import fs from 'node:fs';
import path from 'node:path';

export function getAgentDir() { return '/tmp/fake-agent'; }
export class SessionManager {
  static create(cwd, sessionDir) { return { cwd, sessionDir, kind: 'create' }; }
  static open(file, sessionDir, cwd) { return { cwd, sessionDir, file, kind: 'open' }; }
}
export class ModelRuntime {
  static async create() { return new ModelRuntime(); }
  getModel(provider, id) { return { provider, id }; }
}
function makeSession(manager) {
  const sessionFile = manager.file || path.join(manager.sessionDir, 'session-' + process.pid + '.jsonl');
  const sessionId = manager.kind === 'open' ? 'resumed-session' : 'session-' + process.pid;
  let final = '';
  const messages = [];
  return {
    sessionId,
    sessionFile,
    messages,
    sessionManager: { appendSessionInfo() {} },
    async bindExtensions() {},
    getActiveToolNames() { return ['subagent', 'subagent_supervisor']; },
    async prompt(prompt) {
      if (process.env.FAKE_PI_CAPTURE) fs.writeFileSync(process.env.FAKE_PI_CAPTURE, prompt);
      if (process.env.FAKE_PI_ERROR === '1') {
        messages.push({ role: 'assistant', stopReason: 'error', errorMessage: '402: Insufficient Balance', content: [] });
        return;
      }
      final = 'MISSION_ID: mission-test\\nSTATUS: PASS';
      messages.push({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: final }] });
    },
    getLastAssistantText() { return final; },
    dispose() {},
  };
}
export async function createAgentSessionServices(options) {
  return {
    ...options,
    modelRuntime: await ModelRuntime.create(),
    resourceLoader: { getSkills() { return { skills: [{ name: 'my_pi_executor' }], diagnostics: [] }; } },
    diagnostics: [],
  };
}
export async function createAgentSessionFromServices(options) {
  return { session: makeSession(options.sessionManager) };
}
export async function createAgentSessionRuntime(factory, options) {
  const created = await factory(options);
  return { session: created.session, services: created.services, async dispose() { created.session.dispose(); } };
}
`);
  return pathToFileURL(file).href;
}

test('repository contains only the governed task-scoped implementation', () => {
  const files = fs.readdirSync(root, { recursive: true }).map(String)
    .filter((file) => !file.startsWith('.git/'));
  const shellExtension = ['.', 's', 'h'].join('');
  assert.deepEqual(files.filter((file) => file.endsWith(shellExtension)), []);
  assert.deepEqual(fs.readdirSync(path.join(root, 'scripts')), ['entrypoint.mjs']);
  assert.equal(fs.existsSync(path.join(root, 'workflows')), false);
  const sources = files.filter((name) => /^(?:scripts\/.*\.(?:mjs|js|ts)|package\.json)$/.test(name))
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  const forbidden = [
    ['missions', 'projects'].join('/'),
    ['mission', 'store'].join('_'),
    ['create', 'Server'].join(''),
    ['.', 'sock'].join(''),
    ['global', 'busy'].join(' '),
    ['runtime', 'registry'].join(' '),
    ['bws', 'safe'].join('-'),
    ['bin', 'sh'].join('/'),
  ];
  assert.equal(forbidden.some((marker) => sources.toLowerCase().includes(marker.toLowerCase())), false);
  assert.doesNotMatch(sources, /shell:\s*true/);
  assert.equal(sources.includes(['entrypoint', shellExtension].join('')), false);
  assert.equal(sources.includes(['sh ', '-n'].join('')), false);
});

test('Node accepts the runtime entrypoint syntax', () => {
  const result = spawnSync(process.execPath, ['--check', entrypoint], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('two run calls create independent Pi AgentSession parents', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const env = { MY_PI_EXECUTOR_SDK_MODULE: fakeSdk(tmp) };
  const input = { title: 'test', goal: 'do a bounded test', acceptance: ['returns PASS'], workspace: tmp };
  const [first, second] = await Promise.all([run(['run'], input, env), run(['run'], input, env)]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const a = JSON.parse(first.stdout);
  const b = JSON.parse(second.stdout);
  assert.notEqual(a.runtimePid, b.runtimePid);
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionFile, b.sessionFile);
});

test('run delegates orchestration without recursively invoking the entrypoint', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const capture = path.join(tmp, 'prompt.txt');
  const result = await run(['run'], {
    title: 'test', goal: 'do a bounded test', acceptance: ['returns PASS'], workspace: tmp,
  }, { MY_PI_EXECUTOR_SDK_MODULE: fakeSdk(tmp), FAKE_PI_CAPTURE: capture });
  assert.equal(result.code, 0, result.stderr);
  const prompt = fs.readFileSync(capture, 'utf8');
  assert.match(prompt, /ALREADY_ACTIVE_MY_PI_EXECUTOR_PARENT=1/);
  assert.match(prompt, /Never invoke my_pi_executor, entrypoint\.mjs, or another parent Runtime/);
  assert.equal(prompt.includes(['workflow', 'ScriptPath'].join('')), false);
  assert.equal(prompt.includes(['workflows', 'executor'].join('/')), false);
});

test('answer reopens the exact Pi session and keeps the Mission lineage', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const capture = path.join(tmp, 'prompt.txt');
  const sessionFile = path.join(tmp, 'original.jsonl');
  const result = await run([
    'answer', '--workspace', tmp, '--session', sessionFile, '--mission', 'mission-123',
  ], { answer: 'approved' }, {
    MY_PI_EXECUTOR_SDK_MODULE: fakeSdk(tmp), FAKE_PI_CAPTURE: capture,
  });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sessionFile, sessionFile);
  assert.match(fs.readFileSync(capture, 'utf8'), /SAME Mission mission-123/);
});

test('provider error fails closed', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const result = await run(['run'], {
    title: 'test', goal: 'do a bounded test', acceptance: ['returns PASS'], workspace: tmp,
  }, { MY_PI_EXECUTOR_SDK_MODULE: fakeSdk(tmp), FAKE_PI_ERROR: '1' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /402: Insufficient Balance/);
  assert.equal(result.stdout, '');
});
