# Dependencies

This file is the maintained dependency and deployment inventory for `MY_executor`. Any new material external runtime, path, service, credential boundary, or compatibility constraint must be added here in the same change that introduces it.

## Runtime Dependencies

| Dependency | Requirement / compatibility boundary | Ownership |
|---|---|---|
| Node.js | Must execute the repository's ES-module `.mjs` runtime. `MY_executor/scripts/entrypoint.sh` uses `EXECUTOR_NODE_BIN` when set, otherwise `/home/ubuntu/.local/bin/node`, then `PATH`. | External runtime |
| Pi CLI | Must provide `pi --mode rpc`, RPC state/prompt/event commands used by this repository, durable sessions, and native `--session <path|id>` resume. | External runtime |
| Pi Mission / session state | Pi remains the durable owner of Mission/session state. This repository must not create a second persistent task/checkpoint database. | External generated state |
| Model provider | Default runtime model is `deepseek/deepseek-v4-pro`; `EXECUTOR_MODEL` may override it. Provider credentials are external secrets. | External service |

## Credential Boundary

The repository stores no secrets.

`MY_executor/scripts/entrypoint.sh` accepts already-inherited provider credentials. On Oracle it may use the existing generic `bws-safe` broker per invocation with project id read from `/home/ubuntu/.config/bws/project-id` (override: `EXECUTOR_BWS_PROJECT_FILE`). Credential plumbing must not own Executor task/session lifecycle or concurrency semantics.

Recognized inherited provider variables currently include:

- `DEEPSEEK_API_KEY`
- `ZAI_API_KEY`
- `OPENROUTER_API_KEY`

## Deployment / Discovery

Production is a governed materialized read-only Skill deployment, not a mutable clone or symlink.

Canonical production path:

```text
/home/ubuntu/.agents/skills/MY_executor
```

The deployment flow is intentionally external and generic:

```text
this repository commit
  -> exact immutable SHA recorded by existing Skill governance
  -> governance validation / skill-sync
  -> ~/.agents/skills/MY_executor
  -> Hermes operator and Codex discover the same governed copy
```

The Skill-governance repository/registry is therefore an explicit deployment dependency, but it must not duplicate `MY_executor` implementation behavior.

## Caller Boundary

Allowed callers:

- Hermes `Main -> operator -> MY_executor Skill`
- Codex -> `MY_executor Skill`

No Executor-specific Hermes plugin, routing Skill, global Host, Unix socket, or persistent Executor daemon is a required dependency.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and messaging bridges are unrelated dependencies and must not be added to this execution chain.

## Server Paths / Generated State

The following are deployment/runtime locations, not source authority:

- `/home/ubuntu/.agents/skills/MY_executor` — governed production Skill copy;
- `~/.pi/agent/...` — Pi-generated session/Mission state;
- `${EXECUTOR_SESSION_DIR}` or default `~/.pi/agent/sessions/executor` — Executor parent session storage;
- target task workspace — supplied per invocation;
- `/home/ubuntu/.config/bws/project-id` — optional credential-broker project id only.

## Legacy Components That Must Stay Retired

These were part of the old scattered implementation and are not dependencies of the current architecture:

- `persistent-executor-routing` Skill;
- `pi-executor-bridge` Hermes plugin;
- `executor-harness.service`;
- `executor-harness.sock`;
- global `Host` / global `busy` state;
- legacy shared `executor` implementation outside this repository.

`migration/cleanup_legacy_oracle.sh` is the repository-owned cleanup artifact for these legacy layers.

## Review Rule

A release is not repository-closed if production requires a material file, script, plugin, service, or behavior that is neither:

1. contained in this repository; nor
2. declared here as a generic/versioned external dependency.

In that case the release must be treated as incomplete until the dependency is declared or the scattered implementation is moved into this repository.
