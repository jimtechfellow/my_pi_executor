// Executor worker/reviewer workflow. Runtime and parent lifecycle live in the
// same executor Skill; this file only owns the child execution/review loop.

const workerTask = [
  'Perform the authorized task from the parent context.',
  'Work only in the assigned workspace.',
  'Run deterministic acceptance commands when available.',
  'If you genuinely need a user decision, approval, or a choice between material options, call contact_supervisor({ reason: "need_decision", message: "<one clear question>" }) and stay alive until the reply arrives. Do not guess.',
  'Report changed files and evidence, but do not claim acceptance without command output.'
].join('\n');

const reviewerTask = [
  'You are an independent reviewer. The authorized task, scope, and deterministic acceptance criteria come from the parent original task contract inherited via fork.',
  'Inspect real files and run the stated acceptance commands or an equivalent deterministic check.',
  'Do not trust a worker completion claim. Return only the structured verdict.',
  'Use PASS only when evidence proves the requested result; otherwise FAIL.'
].join('\n');

const writerTask = (review) => [
  'Fix only the verified reviewer findings below in the assigned workspace.',
  'Run the relevant deterministic checks after the fix.',
  'Reviewer evidence:',
  JSON.stringify(review.structuredOutput || { verdict: 'FAIL', findings: [review.output] })
].join('\n');

const reviewerSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } }
  },
  required: ['verdict', 'findings', 'evidence'],
  additionalProperties: false
};

const phase = typeof state !== 'undefined' ? state : null;

if (phase) {
  await phase.set('status', 'worker-running');
  await phase.set('nextReadyAction', 'worker running');
}

let worker = await runs.run('worker-initial', {
  agent: 'worker',
  context: 'fork',
  task: workerTask,
  acceptance: { level: 'checked', evidence: ['changed-files', 'commands-run'] }
});

const rounds = [];
for (let round = 1; round <= 3; round += 1) {
  if (phase) {
    await phase.set('status', `review-round-${round}`);
    await phase.set('nextReadyAction', `review round ${round}`);
  }

  let review;
  try {
    review = await runs.run(`review-${round}`, {
      agent: 'reviewer',
      context: 'fork',
      task: reviewerTask,
      outputSchema: reviewerSchema
    });
  } catch (err) {
    if (phase) {
      await phase.set('status', 'failed');
      await phase.set('nextReadyAction', '');
    }
    rounds.push({ round, runId: null, ok: false, verdict: 'FAIL', evidence: [], failClosed: true, error: String(err?.message || err) });
    return { status: 'FAILED', rounds, workerRunId: worker.runId, failClosed: true };
  }

  if (!review.ok) {
    if (phase) {
      await phase.set('status', 'failed');
      await phase.set('nextReadyAction', '');
    }
    rounds.push({ round, runId: review.runId, ok: false, verdict: review.structuredOutput?.verdict, evidence: review.structuredOutput?.evidence, failClosed: true });
    return { status: 'FAILED', rounds, workerRunId: worker.runId, failClosed: true };
  }

  const verdict = review.structuredOutput?.verdict;
  rounds.push({ round, runId: review.runId, ok: review.ok, verdict, evidence: review.structuredOutput?.evidence });

  if (verdict === 'PASS') {
    if (phase) {
      await phase.set('status', 'completed');
      await phase.set('nextReadyAction', '');
    }
    return { status: 'PASS', rounds, workerRunId: worker.runId };
  }

  if (round === 3) {
    if (phase) {
      await phase.set('status', 'failed');
      await phase.set('nextReadyAction', '');
    }
    return { status: 'FAILED', rounds, workerRunId: worker.runId };
  }

  worker = await runs.run(`writer-${round}`, {
    agent: 'worker',
    context: 'fork',
    task: writerTask(review),
    acceptance: { level: 'checked', evidence: ['changed-files', 'commands-run'] }
  });
}

throw new Error('unreachable: review rounds are hard-capped at three');
