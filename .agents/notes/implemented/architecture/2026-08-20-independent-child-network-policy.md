# Agent Note: Independent child-process network policy

Status: implemented

English | [中文](2026-08-20-independent-child-network-policy.zh.md)

## Problem

The process sandbox governs filesystem effects only. A command running under `read-only` or `workspace-write` can still open remote and loopback connections, and switching to `danger-full-access` bypasses the runner entirely. Filesystem authority therefore determines neither the intended network authority nor whether descendants inherit a network restriction. The generic approval path can widen file access for one call, but it cannot name or enforce an approved network destination.

## Decision

Add a network policy to the complete per-call sandbox policy without merging it into `SandboxMode`. A fresh policy denies Internet-protocol connections while retaining local Unix-domain IPC. The sandboxing shell executors call `ctx.sandbox` whenever either filesystem or network policy needs enforcement; `danger-full-access` bypasses only the file restriction. Host-owned provider requests remain outside `ctx.shell` and therefore outside this policy.

The local provider will enforce the deny policy for the wrapped process and every descendant. Bubblewrap creates a private network namespace, Seatbelt denies network operations, and the Landlock launcher installs an inherited seccomp filter that rejects non-Unix sockets and `io_uring_setup` before `exec`. A backend that cannot enforce the selected network policy fails with `SANDBOX_UNAVAILABLE` before the command runs. Enforcement reporting separates file and network completeness so a partial filesystem mechanism cannot obscure a complete network result, or vice versa.

Exact-destination approval is deferred. A future policy may carry a normalized host and port for one command lifetime, but it must be enforceable for the complete descendant tree and audited separately from file escalation. Until then, every agent-controlled command remains deny-only: approving `danger-full-access` never enables networking.

## Alternatives considered

**Treat `danger-full-access` as unrestricted network approval.** Rejected because the file mode says nothing about destination, duration, or network purpose. Coupling the permissions would let a write approval silently authorize egress.

**Rely on proxy environment variables.** Rejected because untrusted commands can ignore or unset them, use another protocol, invoke raw sockets, or launch a descendant with a different environment. Enforcement belongs below the process.

**Remove network-capable command-line programs from `PATH`.** Rejected because runtimes and package managers can open sockets directly, copied binaries bypass the roster, and descendants inherit executable access rather than a trustworthy allowlist.

**Report unsupported network confinement as partial and run anyway.** Rejected because partial reporting does not deny the traffic. When the policy promises no connections, an unsupported backend must prevent the command from starting.

**Let the approved retry use unrestricted networking for one process lifetime.** Rejected because time bounding alone does not constrain which destination receives data. The approval phase remains incomplete until the runner enforces the named destination.

## Consequences

- The resolved policy defaults child networking to denied independently of every `SandboxMode` value.
- Linux and macOS profiles deny remote and loopback Internet-protocol connections for the command and descendants while preserving Unix-domain IPC required by local runtimes.
- Backends report network enforcement separately and fail before execution when they cannot provide it.
- Shell and terminal consumers refuse to spawn when a backend reports partial network enforcement.
- Windows shell and terminal execution is unavailable until its backend can enforce the selected network policy completely.

## Testing

Unit and real-runner tests cover direct and descendant denial, remote and loopback targets, preserved Unix-domain IPC, unrestricted files under `danger-full-access`, partial-backend refusal before spawn, and runner failure.

## Deferred work

- Add one-shot approval for one normalized destination, with an audit record naming the host and port and backend enforcement for the complete process tree.
- Add a Windows mechanism that can report `networkEnforcement: 'full'`; until then, sandboxed shell and terminal execution on that backend fails closed.

## Risks

Commands that implicitly download dependencies, contact license or package services, or use local TCP servers fail under the safe default. Local developer workflows must use an explicit destination approval once that phase exists. Seccomp must cover alternate socket creation paths without blocking Unix-domain IPC, and platform mechanisms may lack exact destination filtering; those backends become unavailable for an approved call rather than widening access.
