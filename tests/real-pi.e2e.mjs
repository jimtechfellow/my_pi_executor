import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'scripts', 'entrypoint.mjs');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'my-pi-executor-real-e2e-'));
const target = path.join(workspace, 'worker-review.txt');
fs.writeFileSync(target, 'before\n');

function report(status, detail, code) {
  fs.writeSync(1, `${JSON.stringify({ status, ...detail }, null, 2)}\n`);
  process.exit(code);
}

function isExternalDependency(message) {
  return /(?:pi(?:\.cmd)? was not found on PATH|does not resolve to @earendil-works\/pi-coding-agent|required native pi-subagents tools|model is unavailable|no models available|api key|credential|authentication|unauthorized|insufficient balance|\b(?:401|402|403|429)\b)/i
    .test(message);
}

function subagentToolArguments(sessionFile) {
  const calls = [];
  for (const line of fs.readFileSync(sessionFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const stack = [entry];
    while (stack.length > 0) {
      const value = stack.pop();
      if (!value || typeof value !== 'object') continue;
      if (value.type === 'toolCall' && value.name === 'subagent') {
        calls.push(JSON.stringify(value.arguments ?? value.input ?? {}));
      }
      stack.push(...Object.values(value));
    }
  }
  return calls.join('\n');
}

const child = spawn(process.execPath, [entrypoint, 'run', '--workspace', workspace], {
  cwd: root,
  env: {
    ...process.env,
    MY_PI_EXECUTOR_DISABLE_BWS: '1',
    MY_PI_EXECUTOR_SESSION_DIR: path.join(workspace, 'sessions'),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
child.stdin.end(JSON.stringify({
  title: 'real Pi worker-review smoke test',
  goal: 'Use one real worker to change worker-review.txt from before to after-review, then use a fresh reviewer. Apply a fix worker only if the reviewer finds a concrete issue; otherwise finish.',
  acceptance: [
    'worker-review.txt contains exactly after-review followed by a newline',
    'the retained run lineage contains a worker followed by a fresh reviewer',
    'the final result reports at least one and at most three review rounds',
  ],
  workspace,
}));

const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (status) => resolve(status ?? 1));
});

if (code !== 0) {
  const reason = stderr.trim().slice(0, 1000) || `entrypoint exited ${code}`;
  report(isExternalDependency(reason) ? 'EXTERNAL_DEPENDENCY' : 'FAILED', { reason }, 2);
}

let result;
try {
  result = JSON.parse(stdout);
} catch (error) {
  report('FAILED', { reason: `entrypoint returned invalid JSON: ${error.message}` }, 1);
}
if (result.status !== 'PASS') {
  report(result.status, { missionId: result.missionId, reason: result.failure || result.final }, 1);
}
if (!result.missionId || result.rounds < 1 || result.rounds > 3) {
  report('FAILED', { missionId: result.missionId, reason: 'invalid Mission id or review-round count' }, 1);
}
if (fs.readFileSync(target, 'utf8') !== 'after-review\n') {
  report('FAILED', { missionId: result.missionId, reason: 'worker output was not applied' }, 1);
}
const lineage = subagentToolArguments(result.sessionFile);
const workerIndex = lineage.search(/\bworker\b/i);
const reviewerIndex = lineage.search(/\breviewer\b/i);
if (workerIndex < 0 || reviewerIndex <= workerIndex) {
  report('FAILED', { missionId: result.missionId, reason: 'session lacks a worker followed by a fresh reviewer' }, 1);
}

report('PASS', {
  missionId: result.missionId,
  rounds: result.rounds,
  sessionFile: result.sessionFile,
}, 0);
