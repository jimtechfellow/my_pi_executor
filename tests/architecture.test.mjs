import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../scripts/runtime.mjs', import.meta.url), 'utf8');
const skill = fs.readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8');

test('runtime is task-scoped and supports native session resume', () => {
  assert.match(runtime, /new PiRpc/);
  assert.match(runtime, /session: before\.ownerSessionId/);
  assert.doesNotMatch(runtime, /net\.createServer|executor-harness\.sock|this\.busy/);
});

test('my_pi_executor forbids global executor runtime ownership', () => {
  assert.match(skill, /name: my_pi_executor/);
  assert.match(skill, /no global Executor Host/i);
  assert.match(skill, /global queue/i);
  assert.match(skill, /--session <path\|id>/);
});
