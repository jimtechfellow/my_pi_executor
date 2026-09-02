# Executor Runtime

Canonical source repository for the complete Executor unit: **runtime + executor Skill + workflow**.

## Final call path

```text
Hermes Main
  -> operator
  -> governed read-only executor Skill
     -> scripts/entrypoint.sh
     -> scripts/runtime.mjs
     -> task-scoped pi --mode rpc
     -> Pi parent session
     -> durable Mission
     -> workflows/executor.js
     -> worker / strict-fork reviewer

Codex
  -> same governed read-only executor Skill
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
  cleanup_legacy_oracle.sh
```

## Development and release boundary

This repository is the **development/source authority** for Executor. Production Agents do not run from a mutable clone or symlink to this repository.

After development and validation succeed:

```text
source commit
  -> pin exact immutable SHA in Agent-Skill-Source governance registry
  -> governance validation
  -> skill-sync
  -> ~/.agents/skills/executor (read-only deployment)
  -> Hermes operator / Codex consume that deployed copy
```

Executor is a first-party system Skill, not a classic expert/`高手 Skill`, but it uses the same fixed-version, reviewable, read-only deployment mechanics.

A new source commit has no production effect until the governance registry explicitly approves that exact SHA.

## Hermes cleanup

After the governed Executor release is present at `~/.agents/skills/executor`, Hermes requires only:

```text
Main/control -> operator -> executor Skill
```

The legacy `persistent-executor-routing` Skill, `pi-executor-bridge` plugin, `executor-harness.service`, global socket, and Host are obsolete Executor layers. `migration/cleanup_legacy_oracle.sh` retires only those legacy layers **after verifying the governed Skill is already deployed**; it never installs or replaces the Skill itself.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and other messaging bridges are outside this repository and outside this migration.
