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
```

- `SKILL.md` defines the Skill contract and parent orchestration rules.
- `scripts/entrypoint.mjs` is the Node entrypoint. It starts or resumes one Pi parent using Pi's public Node SDK.
- `tests/entrypoint.test.mjs` verifies the public boundary and forbidden architecture.
- `package.json` provides the repository test command.

## Requirements

- Node.js
- tested with `@earendil-works/pi-coding-agent` 0.84.2
- tested with `pi-subagents` 0.59.0
- model-provider credentials

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

## Validation

```text
npm run check
```
