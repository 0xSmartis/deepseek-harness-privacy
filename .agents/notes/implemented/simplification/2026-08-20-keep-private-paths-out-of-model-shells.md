# Agent Note: Keep private paths out of model shell environments

Status: implemented

English | [中文](2026-08-20-keep-private-paths-out-of-model-shells.zh.md)

## Problem

The managed shell environment exposed the absolute Harness home as `DSH_HOME` and a JSONL session-log target as `DSH_SESSION_JSONL` to every model-controlled shell process. These values were not credentials, but they named private storage that the filesystem policy is intended to hide. Publishing them gave untrusted commands a direct map to session history, credential storage, settings, attachments, and other user state, and made privacy depend entirely on every process sandbox backend denying the subsequent read.

## Decision

The default `ctx.shellEnv` registry contributes only `DSH_SHELL=1` and the session-scoped `DSH_SESSION_ID`. It does not resolve Harness home or session persistence and has no home-directory configuration. The local subprocess implementations continue to remove every inherited `DSH_*` value before applying the current managed snapshot, so ambient `DSH_HOME`, `DSH_SESSION_JSONL`, and stale nested-Harness values remain absent.

`SessionPersistence.locate()` remains available to trusted host consumers such as hook bridges. A model-controlled shell receives no storage location from that query. The registry still accepts explicit contributions from trusted in-process plugins; the plugin trust assumption makes such a contribution an intentional host decision rather than ambient default exposure.

This decision partially supersedes the model-shell location portion of [the session environment decision](../feature/2026-07-10-agent-session-identity-and-log-location.md). That note continues to own the per-execution registry, session identity, persistence locator, and hook semantics. [Project session directories](../architecture/2026-07-24-project-session-directories.md) continue to expose their transcript path through the host locator, not through a child-process variable. Broad filesystem read confinement remains independently required; removing location hints does not claim that a path an agent guesses is inaccessible.

## Testing

Registry and request-recording tests pin the two built-ins and the absence of default contributors. Bash and pwsh tests cover foreground, background, no-agent, and parent/child collection. A full-loop bash integration supplies ambient `DSH_HOME` and `DSH_SESSION_JSONL` values while a real JSONL persistence backend is mounted; the child observes both as unset while the host can still locate and flush the session log. Keyless snapshot coverage records the assembled shell result.

## Alternatives considered

**Keep the paths and rely on filesystem confinement.** Rejected because revealing a sensitive target is unnecessary authority amplification and turns one backend gap or approved broad read into direct access to private state.

**Replace paths with a model-facing session-information tool.** Rejected because the current model-shell use has no required operation that needs a transcript location. A future bounded host operation can define its own authorization and result instead of reintroducing a general path oracle.

**Remove all managed shell facts.** Rejected because `DSH_SHELL` is a harmless execution marker and the session-scoped id supports correlation within the current session without identifying a private storage location or creating a cross-session user identifier.

**Reserve every former key permanently.** Rejected because trusted in-process plugins are already inside the host trust boundary and may intentionally define deployment-specific facts. The privacy default removes the built-in contributions; it does not pretend to confine installed host code.

## Consequences

Model-controlled shells cannot discover Harness home or the active transcript target from default `DSH_*` variables, including when those names exist in the parent process. Host hooks retain exact transcript locations. Pre-release scripts that used `DSH_HOME` or `DSH_SESSION_JSONL` inside model shell calls must use an explicitly authorized host capability or user-supplied path instead.

The change reduces path disclosure but does not complete filesystem confinement: commands may infer or guess paths, ordinary non-`DSH_*` environment variables still follow the subprocess policy, and trusted plugins can explicitly add managed facts. Kernel-enforced read roots and scoped filesystem approvals remain separate work.
