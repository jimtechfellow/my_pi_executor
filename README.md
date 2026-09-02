# my_pi_executor

The repository root is the complete Skill and the only source authority for its behavior.

## Files

- `SKILL.md` defines invocation and orchestration.
- `scripts/entrypoint.mjs` starts one independent Pi RPC parent per call and optionally obtains provider credentials through the host's generic `bws-safe` broker.
- `scripts/pi_rpc.mjs` implements only Pi's documented LF-delimited RPC transport.
- `workflows/executor.js` implements the bounded worker/reviewer/fix loop that Pi does not provide as a single native operation.
- `tests/entrypoint.test.mjs` verifies the public invocation boundary, independent parents, native resume arguments, and forbidden architecture.

Runtime dependencies are Node.js, Pi 0.84.2-compatible RPC/session behavior, and `pi-subagents` 0.59.0-compatible Mission/workflow actions. Provider credentials and generated Pi Mission/session state remain external.

The implementation follows Pi's documented [RPC protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) and [session resume interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md), plus `pi-subagents`' native [Mission management and recovery actions](https://github.com/nicobailon/pi-subagents/blob/main/docs/missions.md).

Production is a read-only materialized copy at `/home/ubuntu/.agents/skills/my_pi_executor`, deployed from an immutable commit recorded in the existing Skill governance registry. Hermes and Codex discover that same directory. No Executor-specific plugin, routing Skill, daemon, socket, global Host, or server-only implementation is part of the call path.

Validation:

```text
npm run check
```
