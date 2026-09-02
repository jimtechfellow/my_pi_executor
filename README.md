# MY_executor Runtime

Canonical source repository for the complete `MY_executor` unit: **runtime + Skill + workflow**.

## Review entry points

For human review, start here:

1. `ARCHITECTURE.md` — implementation boundary, allowed external layers, repository-closure acceptance.
2. `DEPENDENCIES.md` — maintained external runtime, deployment, path, credential, and compatibility dependencies.
3. `MY_executor/SKILL.md` — canonical Executor behavior contract.
4. `MY_executor/scripts/` and `MY_executor/workflows/` — implementation owned by that Skill/runtime version.
5. `migration/` and `tests/` — deployment cleanup and architectural regression checks.

A production change is incomplete if unique Executor implementation exists outside this repository or a material external dependency is not declared in `DEPENDENCIES.md`.

## Final call path

```text
Hermes Main
  -> operator
  -> governed read-only MY_executor Skill
     -> scripts/entrypoint.sh
     -> scripts/runtime.mjs
     -> task-scoped pi --mode rpc
     -> Pi parent session
     -> durable Mission
     -> workflows/executor.js

Codex
  -> same governed read-only MY_executor Skill
```

There is no Executor-specific daemon, Unix socket, global Host, global `busy`, or single-active-Mission policy.

## Repository layout

```text
MY_executor/
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

This repository is the development/source authority. Production never runs from a mutable clone or symlink.

```text
source commit
  -> pin exact immutable SHA in the existing Agent-Skill-Source governance registry
  -> governance validation
  -> skill-sync
  -> ~/.agents/skills/MY_executor (read-only deployment)
  -> Hermes operator / Codex consume that deployed copy
```

`MY_` is only a naming convention for our own Skills. It does not create a second governance category, registry, directory, or deployment path.

## Hermes cleanup

After the governed `MY_executor` release is present, Hermes requires only:

```text
Main/control -> operator -> MY_executor Skill
```

The legacy `persistent-executor-routing` Skill, `pi-executor-bridge` plugin, `executor-harness.service`, global socket, and Host are obsolete Executor layers. `migration/cleanup_legacy_oracle.sh` retires only those legacy layers after verifying `MY_executor` is already deployed.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and other messaging bridges are out of scope.
