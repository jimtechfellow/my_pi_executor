---
name: my_pi_executor
description: Execute an authorized engineering or operations task in an independent Pi parent with durable Mission state, native HITL continuation, and independent review.
---

# my_pi_executor

Use this Skill for authorized state-changing work that benefits from durable Mission state and independent verification.

## Invoke

Pass `{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}` on stdin:

```text
/home/ubuntu/.agents/skills/my_pi_executor/scripts/entrypoint.mjs run --workspace /absolute/path
```

The JSON result contains `sessionFile`; retain it with the returned Mission id. Reopen that exact parent for HITL or recovery:

```text
entrypoint.mjs answer --workspace /absolute/path --session <session-file> --mission <mission-id>
entrypoint.mjs recover --workspace /absolute/path --session <session-file> --mission <mission-id>
```

`answer` accepts `{"answer":...}` on stdin.

## Parent contract

When `ALREADY_ACTIVE_MY_PI_EXECUTOR_PARENT=1` appears in the request, this parent is the active executor. Follow this contract directly and never invoke this Skill, its entrypoint, or another parent Runtime recursively.

1. Before delegating, create exactly one Mission with native `mission.create` and use it for the whole call.
2. Apply the installed pi-subagents parent-controlled review-loop technique: one implementation worker, fresh-context reviewers, then one fix worker when needed. Stop on acceptance, a genuine external/HITL dependency, or after three review rounds.
3. Attach retained runs to the Mission. The Pi parent owns Mission updates and supervisor interaction; children do not.
4. If a child requests a decision, record one open decision with `mission.update`, preserve the retained run, and return `NEEDS_DECISION` without guessing.
5. On `answer`, use native `mission.show`, resolve that open decision, inspect native retained-child state, and continue only the same lineage.
6. On `recover`, use `mission.show`; re-present an open decision, resume only a child that native `children.list` reports resumable, or fail closed.
7. Never create replacement Mission state, repeat a completed side effect, or add another persistence, lifecycle, or coordination mechanism.

Independent invocations own independent Node processes and Pi `AgentSession` parents. Only work inside one parent may be serialized.

## Result

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

Pi and pi-subagents exclusively own Mission and session state. Do not parse or mirror their storage.
