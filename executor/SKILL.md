---
name: executor
description: Execute an authorized engineering or operations task through a task-scoped Pi runtime, durable Mission state, native HITL continuation, and independent worker/reviewer verification.
version: 3.0.0
status: active
owner: jimtechfellow
platforms: [linux]
risk_level: high
tags: [executor, pi, mission, hitl, recovery, worker, reviewer, runtime]
---

# Executor

This directory is the complete Executor unit: **Skill + Runtime + workflow**. It is the sole authority for Executor implementation behavior.

## Boundary

Calling agents only decide **when** to use Executor and pass the authorized goal, acceptance criteria, workspace, and exclusions. They do not implement Mission, HITL, recovery, reviewer, runtime-lifecycle, or concurrency behavior themselves.

The runtime is task-scoped. There is no global Executor Host, global socket, global busy flag, global queue, or single-active-Mission policy.

- A new independent Executor call starts its own `pi --mode rpc` process and Pi parent session.
- The Pi process may exit after the turn settles; the Pi session and Mission remain durable on disk.
- A later answer/recovery resumes the original Pi parent with Pi's native `--session <path|id>` support.
- Independent calls may therefore overlap naturally. Serialization is only inside one Pi parent while that parent is processing a turn.

## Entry point

The bundled runtime is:

`./scripts/runtime.mjs`

Hermes can invoke it directly from this Skill using `${HERMES_SKILL_DIR}/scripts/runtime.mjs` through `terminal`. Codex uses the installed shared path (normally `/home/ubuntu/.agents/skills/executor/scripts/runtime.mjs`). No Executor-specific Hermes plugin or persistent harness service is required.

### Start a task

Pass JSON on stdin:

```json
{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}
```

Run:

```bash
node ${HERMES_SKILL_DIR}/scripts/runtime.mjs run --workspace /absolute/path
```

For Codex, use the installed absolute path instead of `${HERMES_SKILL_DIR}`.

### Answer a Mission decision

Pass `{"answer":"..."}` on stdin and run:

```bash
node ${HERMES_SKILL_DIR}/scripts/runtime.mjs answer --workspace /absolute/path --mission <mission-id>
```

### Recover a non-terminal Mission

```bash
node ${HERMES_SKILL_DIR}/scripts/runtime.mjs recover --workspace /absolute/path --mission <mission-id>
```

### Read status

```bash
node ${HERMES_SKILL_DIR}/scripts/runtime.mjs status --workspace /absolute/path [--mission <mission-id>]
```

## Parent orchestration contract

The Pi parent session owns the Mission and HITL loop. `workflows/executor.js` owns only the worker/reviewer/fix loop.

1. **Diagnose before delegation.** Search the read-only AI Knowledge view at `/home/ubuntu/.local/share/ai-knowledge-executor-ro` for prior decisions, deployment state, and known faults. Use current external evidence when facts may have changed. Do not inject the whole knowledge tree into a child.
2. **Preserve the original task contract.** Keep the target, authorization boundary, workspace, exclusions, and deterministic acceptance criteria in the parent context. The reviewer must inherit this original contract via strict `context: "fork"`; do not materialize a `SPEC.md`.
3. **Create exactly one durable Mission before work:** `subagent({ action: "mission.create", mission: { title, objective } })` and capture `missionId`.
4. **Launch the bundled workflow async and bind it to that Mission:** `subagent({ workflowScriptPath: "<this-skill>/workflows/executor.js", missionId, cwd: "<workspace>", async: true })`. Then wait for the workflow until it either reaches a real user decision or terminal completion. Never re-launch the whole workflow to recover a step.
5. **HITL — worker needs a decision.** The worker calls `contact_supervisor({ reason: "need_decision", message })`. The parent persists exactly ONE open decision on the SAME Mission with `mission.update`, captures that decision id, surfaces the question to the caller, and ends the turn. `needs_decision` is a waiting state, not completion.
6. **HITL — user answered.** Resolve the SAME decision id with `mission.resolve-decision`. If the original supervisor route is live, reply through it; otherwise resume only the retained child whose Mission state proves it is resumable. Continue the SAME Mission lineage and wait for the post-decision workflow/reviewer.
7. **Recovery.** Runtime `answer`/`recover` reopens the original Pi parent using the Mission's `ownerSessionId` with Pi native `--session`. Inside that parent, use only native Mission/run state: terminal -> no-op; open decision -> re-present/answer the same decision; retained resumable child -> native resume; completed step -> never re-run; ambiguous state -> fail closed. No external recovery extension or second registry is required.
8. **Review.** Every reviewer is an explicit strict fork from the parent original task context. Never trust worker self-certification. A failed third review ends the workflow; never start a fourth round.

## Result contract

Return compactly:

```text
STATUS: PASS | FAILED | NEEDS_DECISION | EXTERNAL_DEPENDENCY
MISSION_ID:
RUN_LINEAGE:
ROUNDS:
DIAGNOSIS:
CHANGES:
VERIFICATION:
EVIDENCE:
REMAINING:
ARTIFACTS:
```

`EXTERNAL_DEPENDENCY` is only for genuinely missing credentials/permissions, required user input, or an unauthorized high-risk action.

## Safety

- Mission is the only durable Executor source of truth.
- Never build a second task/checkpoint database, global scheduler, or global runtime registry.
- Never duplicate a side effect when Mission state cannot prove the safe next action.
- Never let transport/messaging/profile integration become a second Executor runtime.
- Credentials may be injected by the host environment, but credential plumbing must not own Executor session/Mission lifecycle.
