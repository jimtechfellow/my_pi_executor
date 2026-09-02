# my_pi_executor

This repository root is the complete Skill and the sole source authority.

Only two runtime files are needed: `SKILL.md` defines orchestration and recovery invariants; `scripts/entrypoint.mjs` opens one task-scoped Pi `AgentSessionRuntime` through Pi's public Node SDK. When necessary, the Node entrypoint obtains the BWS access token from systemd credentials and selects only supported provider keys from the native `bws` response. `tests/entrypoint.test.mjs` verifies the public boundary and forbidden architecture.

The implementation targets the server-installed `@earendil-works/pi-coding-agent` 0.84.2 public SDK and `pi-subagents` 0.59.0 native Mission, retained-child, and review-loop capabilities. It does not read Pi storage or implement transport, scheduling, review workflow, recovery state, or shared lifecycle infrastructure.

The verified default model is `openai/gpt-5.6-terra`; `MY_PI_EXECUTOR_MODEL=provider/model` may override it.

Authoritative interfaces:

- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md)
- [pi-subagents Missions](https://github.com/nicobailon/pi-subagents/blob/main/docs/missions.md)

Production is materialized from an immutable approved commit at `/home/ubuntu/.agents/skills/my_pi_executor`; Hermes and Codex use that same directory.

Validate with `npm run check`.
