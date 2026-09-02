# Architecture

## Authority

This repository is the canonical implementation authority for `MY_executor`. The implementation boundary is the repository, not an Oracle server directory, Hermes profile, systemd unit, or temporary deployment path.

`MY_executor/` is one versioned unit containing the Skill and the runtime code that jointly define Executor behavior. A production deployment must correspond to a reviewable repository commit.

## External Call Boundary

The intended caller boundary is deliberately small:

```text
Hermes Main -> operator -> MY_executor Skill
Codex -> MY_executor Skill
```

Callers decide when to invoke the Skill and provide the authorized task context. Executor-specific lifecycle, concurrency, recovery, workflow, and validation behavior must not be reimplemented in caller Profiles, plugins, routing Skills, services, or bridges.

`Ask Hermes`, custom MCPs, CC Connect MCPs, and messaging bridges are separate systems and are outside this repository.

## Repository Closure

Implementation-owned artifacts belong here, including:

- the Skill definition;
- runtime/process-control code;
- workflow code;
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
