# my_pi_executor

`my_pi_executor` is a task-scoped Pi Executor Skill for authorized engineering and operations work.

Each invocation creates an independent Pi parent runtime. Mission/session state, HITL continuation, retained children, and recovery are owned by Pi and `pi-subagents`; this repository does not maintain a second persistence, scheduling, or lifecycle layer.

## Repository

```text
.gitignore
README.md
README.chs.md
SKILL.md
package.json
scripts/entrypoint.mjs
tests/entrypoint.test.mjs
tests/real-pi.e2e.mjs
```

- `SKILL.md` defines the Skill contract and parent orchestration rules.
- `scripts/entrypoint.mjs` is the Node entrypoint. It starts or resumes one Pi parent using Pi's public Node SDK.
- `tests/entrypoint.test.mjs` verifies the public boundary and forbidden architecture.
- `tests/real-pi.e2e.mjs` is the opt-in real Pi/provider chain check.
- `package.json` provides the repository test command.

## Requirements

- Node.js
- validated with `@earendil-works/pi-coding-agent` 0.85.1
- validated with `pi-subagents` 0.66.0
- model-provider credentials

Pi's existing provider settings or environment credentials are used by default. BWS/systemd credential brokering is an optional host integration enabled only with `MY_PI_EXECUTOR_USE_BWS=1`.

## Usage

Start a task by passing JSON on stdin:

```json
{"title":"...","goal":"...","acceptance":["..."],"workspace":"/absolute/path"}
```

```text
scripts/entrypoint.mjs run --workspace /absolute/path
```

The result contains a `sessionFile`. Keep it with the returned Mission id for continuation:

```text
scripts/entrypoint.mjs answer --workspace /absolute/path --session <session-file> --mission <mission-id>
scripts/entrypoint.mjs recover --workspace /absolute/path --session <session-file> --mission <mission-id>
```

`answer` accepts `{"answer":"..."}` on stdin.

The JSON result uses only `PASS`, `FAILED`, `NEEDS_DECISION`, or `EXTERNAL_DEPENDENCY` as `status`, and includes `missionId` and `rounds`. Unparseable final output and Mission-id changes fail closed. The entrypoint also converts a reported fourth fresh-review round to `FAILED`; pi-subagents 0.66.0 documents the three-round default as orchestration guidance and does not expose a review-round runtime hard cap.

## Validation

```text
npm run check
```

Run the opt-in real provider test separately. It performs one real worker → fresh reviewer → fix-or-finish chain:

```text
npm run check:e2e
```

Missing Pi, pi-subagents, or provider credentials are reported as `EXTERNAL_DEPENDENCY`; they are not treated as a passing skip.
