# Agent Note: Allowlist inherited child environment

Status: implemented

English | [中文](2026-08-20-allowlist-inherited-child-environment.zh.md)

## Problem

Local managed children inherited every parent environment variable except names matching `KEY`, `PASSWORD`, `SECRET`, or `TOKEN`, plus the managed `DSH_*` namespace. This heuristic omitted secrets with unrelated names and forwarded `HOME`, product configuration paths, proxy settings, project metadata, and arbitrary deployment state to model shells and out-of-process tools. A denylist could not establish the privacy goal that raw secrets and private-environment hints stay outside model-controlled processes by default.

## Decision

The shared `scrubbedParentEnv()` base retains only variables needed for ordinary process operation: command lookup (`PATH`, `PATHEXT`, `COMSPEC`), operating-system bootstrap (`SYSTEMROOT`, `WINDIR`), locale (`LANG`, `LANGUAGE`, `LC_*`), terminal behavior (`TERM`, `NO_COLOR`), timezone (`TZ`), and temporary directories (`TEMP`, `TMP`, `TMPDIR`). Names match exactly on POSIX and case-insensitively on Windows. Home and configuration paths, proxies, credentials, `DSH_*`, and arbitrary deployment values do not enter the base.

Explicit child `env` remains trusted host authority and merges after that base. A consumer can deliberately provide an API key, endpoint, home directory, product configuration path, proxy, or current `DSH_*` fact when the child operation requires it. Managed shell `dshEnv` values merge last so ordinary plugin environment cannot displace current Harness facts.

The local ordinary and terminal subprocess implementations share this base. SDK-managed DSH and Claude Code subagent transports, the MCP stdio transport, the Web browser opener, and LSP helpers apply the same exported function where their spawn cannot route through `ctx.subprocess`. The E2B provider remains a separate remote execution environment: host ambient variables never enter it, while its sandbox-default discovery and replacement limitations retain their own policy and follow-up.

This decision supersedes the credential-name scrub portions of the stdin/environment, subprocess seam, ACP backend, PTY, MCP, SDK subagent, product subagent, and launch-environment records. Those notes continue to own their broader APIs, lifecycle behavior, and provider decisions.

## Testing

The Service Definition test pins the retained categories and proves that `HOME`, arbitrary metadata, credentials, and ambient `DSH_*` values are absent. Local process tests cover ordinary and terminal spawns, explicit grants, tombstones, and Windows case-insensitive replacement. ACP, DSH SDK, Claude Code, MCP, LSP, Web opener, and full-loop bash tests cover their owned composition paths. The assembled keyless shell snapshot records `HOME`, an arbitrary private metadata path, and the private session-log location as unset while current managed shell facts remain present.

## Alternatives considered

**Expand the secret-name regular expression.** Rejected because no finite set of substrings identifies every secret, private path, proxy, or deployment hint, and every new naming convention would reopen the leak.

**Pass an empty environment.** Rejected because bare executable lookup and supported operating systems require a small set of operational variables; locale, terminal, timezone, and approved temporary storage also affect deterministic child behavior.

**Give every consumer its own allowlist.** Rejected because parallel policy copies would drift. Consumers that own an SDK-managed spawn import the same pure function used by the local provider.

**Implicitly preserve native product homes and endpoints.** Rejected because it would make product convenience silently restore broad host discovery. Product providers document the explicit `env` grants required by native authentication or user configuration.

## Consequences

Managed local children no longer inherit `HOME`, `XDG_*`, proxy variables, `SSH_AUTH_SOCK`, provider endpoints, arbitrary project variables, or unknown secret names. Pre-release configurations that relied on ambient user homes, native authentication, endpoints, proxies, or deployment metadata must grant the required entries in the owning plugin's `env` configuration.

The change does not confine filesystem reads, inspect explicitly granted values, restrict inherited file descriptors, or alter the remote E2B sandbox defaults. The retained operational variables can still disclose limited platform, locale, timezone, terminal, and temporary-directory information. Destination-scoped network grants and kernel-enforced filesystem read roots remain separate privacy work.
