import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../MY_executor/scripts/runtime.mjs', import.meta.url), 'utf8');
const skill = fs.readFileSync(new URL('../MY_executor/SKILL.md', import.meta.url), 'utf8');

test('runtime is task-scoped and supports native session resume', () => {
  assert.match(runtime, /new PiRpc/);
  assert.match(runtime, /session: before\.ownerSessionId/);
  assert.doesNotMatch(runtime, /net\.createServer|executor-harness\.sock|this\.busy/);
});

test('MY_executor forbids global executor runtime ownership', () => {
  assert.match(skill, /name: MY_executor/);
  assert.match(skill, /no global Executor Host/i);
  assert.match(skill, /global queue/i);
  assert.match(skill, /--session <path\|id>/);
});
