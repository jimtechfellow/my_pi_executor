import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'scripts', 'entrypoint.mjs');

function run(args, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

function fakePi(tmp) {
  const file = path.join(tmp, 'fake-pi.mjs');
  fs.writeFileSync(file, `#!/usr/bin/env node
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
    if (!line) continue;
    const command = JSON.parse(line);
    if (command.type === 'get_state') {
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data: { sessionId: 'session-' + process.cwd() + '-' + process.pid, sessionFile: '/tmp/session-' + process.pid + '.jsonl' } }) + '\\n');
    } else if (command.type === 'prompt') {
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true }) + '\\n');
      if (process.env.FAKE_PI_ERROR === '1') {
        process.stdout.write(JSON.stringify({ type: 'agent_end', messages: [{ role: 'assistant', stopReason: 'error', errorMessage: '402: Insufficient Balance', content: [] }], willRetry: false }) + '\\n');
      }
      process.stdout.write(JSON.stringify({ type: 'agent_settled' }) + '\\n');
    } else if (command.type === 'get_last_assistant_text') {
      const text = process.env.FAKE_PI_ERROR === '1' ? null : 'MISSION_ID: mission-test\\nSTATUS: PASS';
      process.stdout.write(JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data: { text } }) + '\\n');
    } else if (command.type === 'abort') process.exit(0);
  }
});
`, { mode: 0o755 });
  return file;
}

test('repository has no shell files or shell entrypoint references', () => {
  const files = fs.readdirSync(root, { recursive: true }).map(String);
  assert.deepEqual(files.filter((file) => file.endsWith('.sh')), []);
  for (const file of files.filter((name) => /\.(?:md|json|mjs|js)$/.test(name))) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(text.includes(['entrypoint', '.sh'].join('')), false, file);
    assert.equal(text.includes(['sh ', '-n'].join('')), false, file);
  }
});

test('workflow is valid as an async Pi workflow body', () => {
  const source = fs.readFileSync(path.join(root, 'workflows', 'executor.js'), 'utf8');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('runs', 'state', source));
  assert.doesNotMatch(source, /\bphase\b/);
});

test('runtime does not parse Pi Mission storage or create global coordination', () => {
  const sources = ['scripts/entrypoint.mjs', 'scripts/pi_rpc.mjs', 'workflows/executor.js']
    .map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /missions\/projects|mission_store|createServer|\.sock|global busy|runtime registry/i);
});

test('two run calls create independent Pi parent processes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const pi = fakePi(tmp);
  const input = { title: 'test', goal: 'do a bounded test', acceptance: ['returns PASS'], workspace: tmp };
  const env = { MY_PI_EXECUTOR_PI_BIN: pi, DEEPSEEK_API_KEY: 'test-only' };
  const [first, second] = await Promise.all([run(['run'], input, env), run(['run'], input, env)]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(second.code, 0, second.stderr);
  const a = JSON.parse(first.stdout);
  const b = JSON.parse(second.stdout);
  assert.match(a.sessionId, new RegExp(tmp));
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.sessionFile, b.sessionFile);
});

test('answer resumes an explicit Pi parent session and Mission lineage', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const pi = fakePi(tmp);
  const result = await run(['answer', '--session', '/tmp/original.jsonl', '--mission', 'mission-123'], { answer: 'approved' }, {
    MY_PI_EXECUTOR_PI_BIN: pi,
    DEEPSEEK_API_KEY: 'test-only',
  });
  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sessionFile, `/tmp/session-${output.piPid}.jsonl`);
  assert.match(output.final, /MISSION_ID: mission-test/);
});

test('provider error fails closed instead of reporting a settled empty result', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-test-'));
  const pi = fakePi(tmp);
  const input = { title: 'test', goal: 'do a bounded test', acceptance: ['returns PASS'], workspace: tmp };
  const result = await run(['run'], input, {
    MY_PI_EXECUTOR_PI_BIN: pi,
    DEEPSEEK_API_KEY: 'test-only',
    FAKE_PI_ERROR: '1',
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /402: Insufficient Balance/);
  assert.equal(result.stdout, '');
});
