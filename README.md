# Pi Executor Harness

Agent-neutral durable Executor Harness built on Pi + pi-subagents.

## Purpose

Agent-neutral durable Executor Harness based on Pi + pi-subagents.

## Architecture

```
Codex / Hermes / other caller
→ thin client (`harness.mjs`)
→ persistent Harness Host (`host.mjs`)
→ pi --mode rpc (persistent parent session)
→ pi-subagents
→ Mission / Worker / HITL / strict-fork Reviewer
```

## Commands

- `doctor` — verify the persistent host, model route, extensions, Mission store, and zero-dependency-upgrade invariants.
- `run` — create a durable Mission, launch the Worker workflow, and (optionally) gate on `needs_decision`.
- `status` — read-only view of Mission store state (the durable source of truth).
- `answer` — continue the SAME parent session: resolve the SAME decision and drive the post-decision step + strict-fork Reviewer.
- `recover` — read-only classification of non-terminal Missions (diagnostic only; nothing executed).

The CLI is a thin client that talks to the persistent host over a 0600 Unix domain
socket (JSONL). Each CLI process exits without terminating the host or the
`pi --mode rpc` parent session.

## Core invariants

- Mission is the sole durable workflow source of truth.
- `contact_supervisor` HITL requires the same persistent Pi parent session.
- Same missionId / decisionId / parent-session lineage.
- No second task/recovery database.
- Fail closed when safe continuation cannot be proven.
- Current baseline intentionally supports one active HITL Mission; no premature scheduler.

## Tested baseline

Known tested baseline (not minimum-required versions):

- Pi 0.84.2
- pi-subagents 0.59.0
- Node v22.23.2

## H2 verified behavior

- CLI exits while the Harness Host + Pi parent session + Worker remain alive.
- A new `answer` CLI process continues the same HITL on the same parent session.
- Same Mission / decision / parent-session lineage.
- Post-decision step executes exactly once.
- strict-fork Reviewer executes successfully.
- Duplicate-side-effect and idempotency checks passed.

## Configuration

Environment-specific paths, the model, and the workspace default are centralized in
`lib/const.mjs`. The checked-in values are the H2-pass deployment's settings and are
intentionally kept as-is; adjust them for your deployment.

## Deployment (optional)

`systemd/` contains sanitized examples of the persistent-host service unit and its
Bitwarden Secrets Manager (BWS) wrapper/drop-in. They contain no secrets; the BWS
project id is read from a file at runtime.
