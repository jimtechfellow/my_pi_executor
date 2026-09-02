# Executor Runtime

Canonical repository for the complete Executor unit: **runtime + executor Skill + workflow**.

## Final call path

```text
Hermes Main
  -> operator
  -> executor Skill
     -> scripts/entrypoint.sh
     -> scripts/runtime.mjs
     -> task-scoped pi --mode rpc
     -> Pi parent session
     -> durable Mission
     -> workflows/executor.js
     -> worker / strict-fork reviewer

Codex
  -> same executor Skill
     -> same task-scoped runtime path
```

There is no Executor-specific daemon, Unix socket, global Host, global `busy`, or single-active-Mission policy.

Each independent call creates its own Pi RPC process/session. When a turn finishes, the process may exit. Mission and Pi session state remain durable. `answer` and `recover` resume the original parent with Pi's native `--session` support.

## Repository layout

```text
executor/
  SKILL.md
  scripts/
    entrypoint.sh
    runtime.mjs
    pi_rpc.mjs
    mission_store.mjs
  workflows/
    executor.js
migration/
  install_oracle.sh
```

## Hermes cleanup

After migration, Hermes requires only its normal routing:

```text
Main/control -> operator -> executor Skill
```

The legacy `persistent-executor-routing` Skill, `pi-executor-bridge` plugin, `executor-harness.service`, global socket, and Host are obsolete Executor layers and are retired by the migration script after backup.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and other messaging bridges are outside this repository and outside this migration.

## Installation model

The repository's `executor/` directory is the single physical copy. Oracle installs symlinks so Hermes and Codex discover the exact same Skill tree:

```text
~/.agents/skills/executor -> <repo>/executor
~/.hermes/skills/autonomous-ai-agents/executor -> <repo>/executor
```

This prevents runtime/Skill version drift.
