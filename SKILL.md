---
name: my_pi_executor
description: Execute an authorized engineering or operations task in its own Pi parent runtime with a durable Mission, native HITL continuation, and independent review.
version: 4.0.0
status: active
owner: jimtechfellow
risk_level: high
---

# my_pi_executor

Use this Skill for authorized state-changing work that benefits from durable Pi Mission state and independent worker/reviewer verification.

## Invocation

Each call directly starts its own `pi --mode rpc` process through `scripts/entrypoint.mjs`. There is no shared Host, service, socket, lock, queue, busy flag, registry, or Executor-specific recovery extension.

Start a task by passing `{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}` on stdin:

```text
/home/ubuntu/.agents/skills/my_pi_executor/scripts/entrypoint.mjs run --workspace /absolute/path
```

The result includes the Pi `sessionFile`. Keep it with the returned Mission id. HITL answer and recovery require both values so Pi can reopen the exact parent without reading its internal Mission files:

```text
entrypoint.mjs answer --workspace /absolute/path --session <session-file-or-id> --mission <mission-id>
entrypoint.mjs recover --workspace /absolute/path --session <session-file-or-id> --mission <mission-id>
```

`answer` receives `{"answer":"..."}` on stdin.

## Pi parent contract

1. Create exactly one Mission with native `mission.create` before launching work.
2. Launch `workflows/executor.js` asynchronously with that Mission id and the authorized workspace.
3. Let the workflow own only its worker/reviewer/fix loop. The Pi parent owns Mission and HITL interaction.
4. If the worker requests a decision, add exactly one decision with `mission.update` and return it to the caller.
5. On `answer`, inspect the Mission with `mission.show`, resolve the same decision id, and continue the retained child through the native supervisor/resume path.
6. On `recover`, use `mission.show`; re-present an open decision, resume only a natively resumable retained child, or fail closed.
7. Never create a replacement Mission, repeat a completed side effect, or run a fourth review.

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

Mission state and session state are owned by Pi and `pi-subagents`. This repository must not parse, mirror, or replace those stores.
