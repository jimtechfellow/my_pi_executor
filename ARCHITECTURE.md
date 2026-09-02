# Architecture

## Authority

This repository is the canonical implementation authority for `my_pi_executor`. The repository root is the Skill root and the complete versioned implementation unit.

The implementation boundary is this repository, not an Oracle server directory, Hermes profile, systemd unit, temporary deployment path, or nested Skill subdirectory.

## External Call Boundary

```text
Hermes Main -> operator -> my_pi_executor Skill
Codex -> my_pi_executor Skill
```

Callers decide when to invoke the Skill and provide the authorized task context. Executor-specific lifecycle, concurrency, recovery, workflow, and validation behavior must not be reimplemented in caller Profiles, plugins, routing Skills, services, or bridges.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and messaging bridges are separate systems and are outside this repository.

## Repository Closure

Implementation-owned artifacts belong here, including:

- `SKILL.md`;
- runtime/process-control code under `scripts/`;
- workflow code under `workflows/`;
- task/session lifecycle and recovery implementation;
- install/migration/cleanup scripts;
- tests;
- maintained dependency and deployment declarations.

A server may contain only deployed/materialized copies, generated runtime state, secrets, and generic host plumbing. It must not contain the only authoritative copy of any Executor behavior.

Thin external infrastructure is allowed only for generic concerns such as credential injection, process bootstrap, platform discovery, or governed Skill distribution. Such infrastructure must not own Executor domain semantics.

## No Server-Only Implementation

A temporary server patch or prototype is not production authority. Before a task can be reported as complete, any implementation that is meant to survive must either:

1. be committed to this repository and deployed from a pinned/reviewable revision; or
2. be removed from the server.

This includes plugins, profile-local code, systemd helpers, ad-hoc scripts, and copied prompt/workflow logic.

## Review Gate

Before reporting an Executor implementation change as PASS, verify all of the following:

1. The relevant source change exists in this repository.
2. `DEPENDENCIES.md` reflects any new external runtime, path, service, credential boundary, or compatibility constraint.
3. No unique Executor implementation remains outside the repository.
4. Production points to a governed, immutable deployment of the repository version.
5. The repository tree and changed files are sufficient for human review without reconstructing behavior from scattered server files.

If any item fails, repository closure is incomplete even if the current server instance works.
