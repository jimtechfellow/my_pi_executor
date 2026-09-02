# my_pi_executor

Canonical source repository for the complete `my_pi_executor` Skill: **Skill + runtime + workflow**.

The repository root is the Skill root. There is no nested Skill directory.

## Review entry points

1. `SKILL.md` — canonical Executor behavior contract.
2. `scripts/` — task-scoped runtime and Pi RPC/session integration.
3. `workflows/` — worker/reviewer workflow.
4. `ARCHITECTURE.md` — implementation boundary and repository-closure acceptance.
5. `DEPENDENCIES.md` — maintained runtime/deployment dependencies.
6. `migration/` and `tests/` — cleanup and regression checks.

A production change is incomplete if unique Executor implementation exists outside this repository or a material external dependency is not declared in `DEPENDENCIES.md`.

## Final call path

```text
Hermes Main
  -> operator
  -> governed read-only my_pi_executor Skill
     -> scripts/entrypoint.sh
     -> scripts/runtime.mjs
     -> task-scoped pi --mode rpc
     -> Pi parent session
     -> durable Mission
     -> workflows/executor.js

Codex
  -> same governed read-only my_pi_executor Skill
```

There is no Executor-specific daemon, Unix socket, global Host, global `busy`, or single-active-Mission policy.

## Repository layout

```text
SKILL.md
scripts/
  entrypoint.sh
  runtime.mjs
  pi_rpc.mjs
  mission_store.mjs
workflows/
  executor.js
tests/
migration/
ARCHITECTURE.md
DEPENDENCIES.md
README.md
```

## Development and release boundary

This repository is the development/source authority. Production never runs from a mutable clone or symlink.

```text
source commit
  -> pin exact immutable SHA in the existing Agent-Skill-Source governance registry
  -> governance validation
  -> skill-sync
  -> ~/.agents/skills/my_pi_executor (read-only deployment)
  -> Hermes operator / Codex consume that deployed copy
```

The governance registry must point to this repository root; no subpath is required.

## Hermes cleanup

After the governed `my_pi_executor` release is present, Hermes requires only:

```text
Main/control -> operator -> my_pi_executor Skill
```

The legacy `persistent-executor-routing` Skill, `pi-executor-bridge` plugin, `executor-harness.service`, global socket, Host, and legacy shared `executor` Skill are obsolete Executor layers. `migration/cleanup_legacy_oracle.sh` retires only those legacy layers after verifying `my_pi_executor` is already deployed.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and other messaging bridges are out of scope.
