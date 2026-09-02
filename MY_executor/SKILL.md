---
name: MY_executor
description: Execute an authorized engineering or operations task through a task-scoped Pi runtime, durable Mission state, native HITL continuation, and independent worker/reviewer verification.
version: 3.0.0
status: active
owner: jimtechfellow
platforms: [linux]
risk_level: high
tags: [executor, pi, mission, hitl, recovery, worker, reviewer, runtime]
---

# MY_executor

This directory is the complete Executor unit: **Skill + Runtime + workflow**. It is the sole authority for Executor implementation behavior.

## Boundary

Calling agents only decide **when** to use MY_executor and pass the authorized goal, acceptance criteria, workspace, and exclusions. They do not implement Mission, HITL, recovery, reviewer, runtime-lifecycle, or concurrency behavior themselves.

The runtime is task-scoped. There is no global Executor Host, global socket, global busy flag, global queue, or single-active-Mission policy.

- A new independent call starts its own `pi --mode rpc` process and Pi parent session.
- The Pi process may exit after the turn settles; the Pi session and Mission remain durable on disk.
- A later answer/recovery resumes the original Pi parent with Pi's native `--session <path|id>` support.
- Independent calls may overlap naturally. Serialization is only inside one Pi parent while that parent is processing a turn.

## Entry point

The bundled entry point is `./scripts/entrypoint.sh`.

Hermes invokes it from this Skill through `terminal` as `sh ${HERMES_SKILL_DIR}/scripts/entrypoint.sh ...`. Codex uses `sh /home/ubuntu/.agents/skills/MY_executor/scripts/entrypoint.sh ...`. No Executor-specific Hermes plugin or persistent harness service is required.

### Start a task

Pass JSON on stdin:

```json
{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}
```

```bash
sh ${HERMES_SKILL_DIR}/scripts/entrypoint.sh run --workspace /absolute/path
```

### Answer a Mission decision

Pass `{"answer":"..."}` on stdin:

```bash
sh ${HERMES_SKILL_DIR}/scripts/entrypoint.sh answer --workspace /absolute/path --mission <mission-id>
```

### Recover / status

```bash
sh ${HERMES_SKILL_DIR}/scripts/entrypoint.sh recover --workspace /absolute/path --mission <mission-id>
sh ${HERMES_SKILL_DIR}/scripts/entrypoint.sh status --workspace /absolute/path [--mission <mission-id>]
```

## Parent orchestration contract

The Pi parent session owns the Mission and HITL loop. `workflows/executor.js` owns only the worker/reviewer/fix loop.

1. Diagnose before delegation using the read-only AI Knowledge view and current evidence where needed.
2. Preserve the original authorized task contract, workspace, exclusions, and deterministic acceptance criteria.
3. Create exactly one durable Mission before work and capture `missionId`.
4. Launch the bundled workflow async bound to that Mission; never relaunch the whole workflow to recover a step.
5. For HITL, persist exactly one open decision on the same Mission and return the question to the caller.
6. On answer, resolve the same decision and continue the same Mission lineage.
7. `answer`/`recover` reopen the original Pi parent using Mission `ownerSessionId` with Pi native `--session`; ambiguous recovery fails closed.
8. Reviewer is an independent strict fork; a failed third review ends the workflow.

## Result contract

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

## Safety

- Mission is the only durable Executor source of truth.
- Never build a second task/checkpoint database, global scheduler, or global runtime registry.
- Never duplicate a side effect when Mission state cannot prove the safe next action.
- Never let transport/messaging/profile integration become a second Executor runtime.
- Credentials may be injected by the host environment, but credential plumbing must not own Executor session/Mission lifecycle.
