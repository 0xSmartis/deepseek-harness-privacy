# dsh-fs-sandbox — the sandbox-enforcing filesystem backend

English | [中文](README.zh.md)

`SandboxedFileSystem` extends [`LocalFileSystem`](../fs-local/README.md) and registers as `ctx.fs`. It inherits the local storage mechanics and adds a per-call file-policy fence to metadata, content, listing, write, and edit operations. `resolve` remains identity mapping. Target-based operations re-canonicalize the resulting target before checking containment; `lstat` canonicalizes the parent while preserving its no-follow final component.

Its plugin config is the local backend config unchanged: `cwd` remains the relative-path resolution default, and `diffBasisMaxBytes` bounds the optional overwrite contextual-diff basis.

Loading it instead of `dsh-fs-local`, together with a [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.md), is the provider swap. Model-facing consumers resolve the calling session's mode and cwd into the same per-call policy used by the shell family.

## The fence

The per-call policy carries the effective mode (session override or escalation grant) together with the calling session's immutable cwd root, falling back to deployment policy only for calls without one:

- `read-only` — reads under the workspace and platform temp roots; denies every mutation with structured `FS_SANDBOX_DENIED`.
- `workspace-write` — reads and writes under the workspace and platform temp roots (`/tmp`, `os.tmpdir()`). [`readableRoots`](../../sandbox/sandbox/src/roots.ts) and [`writableRoots`](../../sandbox/sandbox/src/roots.ts) derive these canonical sets from one policy. Canonical spellings use a lexical fast path; an identity-based ancestor fallback recognizes alias-equivalent roots such as Windows long names and 8.3 names without treating unrelated prefixes as contained. The target is re-canonicalized immediately before delegating, so an ancestor symlink swapped since the tool resolved it is caught.
- `danger-full-access` — delegates unfenced.

## Threat model: a policy fence, not a kernel boundary

The fence is a check in trusted code over a model-controlled path: the operations are the seam's own (`open`, `rename`), while only the target path is untrusted. Kernel-grade isolation of untrusted code stays `ctx.shell`'s job ([`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md)). Re-canonicalizing immediately before delegation narrows the remaining race between the containment check and the filesystem operation; a kernel-tight boundary needs platform-specific `openat2`-class primitives.

A denial is a structured `FsError` (`FS_SANDBOX_DENIED`, carrying the effective mode) — no stderr text inference (unlike bash's kernel denials), because an in-process fence knows exactly what it refused. The model-facing `[sandbox: file access denied under <mode> mode]` marker and the one-approved-wider retry live in the tool layer (`dsh-tool-fs`), exactly as bash's do. See [the cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md).

## Model Experience

### Filesystem policy and refusals

#### What the model sees

The policy owner contributes capability-neutral `sandbox:policy` context. Indirectly, `dsh-tool-fs` renders this backend's `FS_SANDBOX_DENIED` refusals as the `[sandbox: file access denied under <mode> mode]` marker plus the same-turn escalation hint.

#### Token effect

The current-policy clause adds a small runtime-context message while this backend is mounted; a denial adds the bounded marker and escalation hint to conversation history.

#### KV Cache effect

A standing-policy change appends an owner-rendered superseding runtime-context snapshot after retained history; operation results remain append-only.

## Known Limitations and Deferred Work

- **A policy fence, not a kernel boundary** — the check is trusted code over a model-controlled path, so in-place re-canonicalization narrows but does not eliminate the resolve-to-operation race; adversarial host processes are out of scope.
- **Process reads remain separate** — this provider confines trusted `ctx.fs` operations; shell commands still require OS-backend read confinement.
- **Temporary roots are platform-wide** — confined calls may read and, under `workspace-write`, write the host temp areas. Per-session private temporary roots remain separate work.
- **Requires `ctx.sandboxPolicy`** — tools use it to resolve each session policy and the backend uses it for agentless-call fallbacks; the backend does not confine without it composed.
