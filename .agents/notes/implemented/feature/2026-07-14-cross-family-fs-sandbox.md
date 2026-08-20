# Agent Note: Cross-family file sandbox — one policy home, a sandboxed fs provider, and fs escalation parity

Status: implemented

English | [中文](2026-07-14-cross-family-fs-sandbox.zh.md)

## Problem

`SandboxMode` claims file effects, but originally only `ctx.shell` enforced it. The fs tools (`write`/`edit`) mutate the host filesystem in-process through `ctx.fs`, where an OS argv wrapper is mechanically meaningless — [the sandbox Agent Note](2026-07-06-sandbox.md) § In-process tools records this and left cross-family enforcement as a deferred phase with an open question: whether in-process enforcement stays per-seam or becomes a uniform harness capability. This Agent Note is that phase, and answers it: one shared policy home, per-seam enforcement at each family's correct altitude.

The gap was not read-only-shaped. A confined coding agent's product mode is `workspace-write`: bash may already write under the workspace root while everything outside is denied, so an fs enforcement that could only deny-all would be strictly worse than disabling the fs tools — the model would attempt an in-workspace `write`, be denied, and learn to detour through `bash` heredocs. Cross-family enforcement therefore speaks the full mode ladder, including the path-containment judgment `workspace-write` requires (canonical targets; `..`/symlink/absolute-path escapes) and the same escalation lever bash carries.

A second enforcing family also exposed an ownership problem in the original layout. The deployment default (`mode` + `workspaceRoot`) was configured on `dsh-bash-sandbox`, and the per-session override event was `shell/sandbox-mode`, folded and written by `dsh-shell`'s session-mode kit. With fs enforcing the same policy, either fs reads bash's config and events (a capability family depending on a sibling's plugin config) or each family carries its own copy — and two copies of `workspaceRoot` drift into exactly the split world the sandbox RFC warns about: bash confined to one root while fs fences another.

## Decision

Three coordinated pieces, all composed from the leaf `cordis.yml`, none touching `agent-loop`.

### `ctx.sandboxPolicy` — one home for mode and workspace root

`packages/sandbox/sandbox-policy/` (`@deepseek-ai/dsh-sandbox-policy`) registers `ctx.sandboxPolicy`, the single owner of the deployment's sandbox policy:

- `Config`: `mode` (the closed `SandboxMode` union, default `read-only`) and `workspaceRoot` (default the process cwd, resolved absolute). Misconfiguration fails loud at load.
- The per-session override event `sandbox/mode`, with its pure fold (`effectiveSandboxMode(events)`), its write path (`setSandboxMode(session, mode)`), and `SANDBOX_MODES`. The event is policy state — consumed by two families — so it lives here, not in either capability's seam. Its shape and log-only semantics match the `approval/*` precedent.
- `resolve({ session?, mode? })`, which returns a complete per-call `SandboxExecutionPolicy`: explicit approved mode > the session fold > `defaultMode`, and the session's immutable cwd > configured `workspaceRoot` fallback.
- `defaultMode` / `workspaceRoot` accessors retained as deployment fallbacks and the capability-advertisement fact.

`dsh-bash-sandbox` carries no sandbox config of its own — it injects `sandboxPolicy` and uses its deployment fallback only for direct calls. `dsh-tool-bash` and `dsh-tool-fs` pass the active session to `ctx.sandboxPolicy.resolve()`, so both receive the same effective mode and cwd root on every call; `dsh-permission-presets` presets and the ACP bridge write through the relocated setter. The seams that own bash and fs execution remain session-free — the session dependency lives in the policy package and tool consumers.

### `dsh-fs-sandbox` — enforcement inside the provider

`packages/fs/fs-sandbox/` (`@deepseek-ai/dsh-fs-sandbox`) mirrors the `bash-local`/`bash-sandbox` split: `SandboxedFileSystem extends LocalFileSystem`, registered as `ctx.fs`, injecting `sandboxPolicy`. `resolve` maps identity without an access decision. Metadata, content, listing, and mutation operations accept an optional trailing `SandboxExecutionPolicy`; the sandboxed provider uses it to re-canonicalize the accessed identity immediately before containment and delegates with that checked identity. `lstat` canonicalizes the parent and checks the final component's own location so an inside symlink may expose its link metadata without authorizing its outside target, while an outside symlink to an inside target remains denied:

- `read-only` reads under `readableRoots(policy)` and denies `writeText`/`editText` outright.
- `workspace-write` reads under `readableRoots(policy)` and mutates under `writableRoots(policy)`. Both sets contain the realpathed workspace root and platform temp areas (`/tmp`, `os.tmpdir()`). Canonical spellings take a lexical containment fast path; when Windows exposes one directory through different casing or long-name/8.3 spellings, an ancestor walk compares filesystem identity rather than weakening the restriction to textual prefix guesses.
- `danger-full-access` delegates unfenced.

A denial is the structured `FS_SANDBOX_DENIED` carrying the effective mode — distinct from `FS_PERMISSION_DENIED` (a host EACCES is the world refusing; this is policy refusing). No text inference: an in-process fence knows exactly what it denied. The seam stays session-free, and the bare local backend ignores the optional policy. `FileSystem.sandboxMode` is the capability fact (`undefined` on the base and `fs-local`, the default on `SandboxedFileSystem`), so the tool layer advertises escalation from composition truth.

The threat model is stated in the package README: a policy fence in trusted code over model-controlled paths, not a kernel boundary — the operations are the seam's own, only the target path is untrusted, so canonicalize-then-contain is the complete answer to this surface (the `code-runtime` "containment, not a security boundary" precedent). Kernel-grade isolation of untrusted CODE stays `ctx.shell`'s job. The residual resolve-to-syscall race is narrowed by the in-place re-canonicalization and eliminated only by platform primitives (`openat2` `RESOLVE_BENEATH`) not worth their portability cost here.

### Tool parity — one denial marker, one escalation flow

`dsh-tool-fs` resolves the active session's complete policy onto `read`, `read_image`, `write`, and `edit`, and maps `FS_SANDBOX_DENIED` to the marker the model already knows from bash: `[sandbox: file access denied under <mode> mode]`. When `ctx.fs.sandboxMode` reports a confining mode at registration, all four tools advertise paired `sandbox_permissions` + `justification` fields and resolve the same `ctx.approval` request before executing. Reads advertise only `danger-full-access`, because `workspace-write` has the same readable roots as `read-only`; mutations retain the full widening ladder. Strict widening is checked against the call's effective mode; a grant changes only that call's mode and retains its session root.

The shared pieces live in `dsh-sandbox`, which owns the mode types: `WIDER_MODES`, the escalation-target enum, the argument-pairing validation, the denial/hint marker builders, and `approveEscalation` — the ordered fail-closed choreography. `approveEscalation` takes a minimal STRUCTURAL approver (`EscalationApprover`, generic over the agent and call-id types), not the approval service type, so `dsh-sandbox` gains no dependency on the approval or agent packages: each tool passes its own `ctx.approval`, agent, call id, and tool name as ingredients. `dsh-tool-bash` and `dsh-tool-fs` both use these; the cross-file duplication gate holds the single-sourcing honest.

The [`examples/acp-agent`](../../../../examples/acp-agent/cordis.yml) composition loads `dsh-sandbox-policy` and `dsh-fs-sandbox`, moves the `mode`/`workspaceRoot` config to the policy entry, and drops the old gating that disabled the fs stack under confined modes; `fs-observation-policy` (read-before-edit) composes orthogonally on top. The system prompt still states no sandbox mode — the marker teaches the boundary at the moment it matters, per the sandbox Agent Note's live evidence.

### The enforcement point: provider, not intent gate

The sandbox Agent Note's original cross-family sketch put fs enforcement on the `fs/write-intent`/`fs/edit-intent` events. This Agent Note enforces in the provider instead, on two mechanical facts: the intent slots are single-decision first-wins (occupied by `dsh-fs-observation-policy`, whose contract names a second decider a misconfiguration), and the intent events are dispatched only by `dsh-tool-fs` — a direct `ctx.fs` caller (a cordis-mounted plugin, a custom tool) bypasses them, where provider-level enforcement covers every caller by construction.

### Out of scope

- **Network policy for `ctx.web`** — outside this file-policy decision. Process sandboxing now denies Internet-protocol sockets separately; destination-scoped web policy remains separate work.
- **The `subagent-acp` consumer** — unchanged deferred phase of the sandbox RFC.
- **Additional read or write roots inside one session** — the resolved policy carries one primary `SessionHeader.cwd`; ACP `additionalDirectories` remains a separate bridge and policy design.
- **A uniform per-tool sandbox runtime** — remains rejected for the reasons in the sandbox RFC.

## Alternatives considered

- **Enforce on the `fs/*` intent events (the sandbox Agent Note's original sketch)** — rejected on the two mechanical facts in § The enforcement point: single-slot first-wins already occupied, and a bypass for direct `ctx.fs` callers. Provider-level enforcement covers every caller and mirrors bash's swap-the-implementation shape.
- **Enforce in `tools/pre-execute`** — rejected: the listener sees the model's raw path string before `resolve()`, so it would re-implement cwd defaulting and symlink canonicalization and still race the real resolve. Disqualifying for `workspace-write`, a judgment over canonical paths.
- **Inline checks in `dsh-tool-fs`** — rejected: covers only the tool path (same bypass as the intent events) and duplicates resolve knowledge one layer above where the canonical target already exists.
- **A `mode` flag on `dsh-fs-local` instead of a sibling backend** — rejected: the capability fact must be composition truth the way `dsh-bash-local` vs `dsh-bash-sandbox` is; a config flag makes the tool's advertisement conditional on configuration, and the bash family already establishes the sibling-package shape.
- **Kernel-enforced fs mutations via a confined helper subprocess** — rejected: a process per write; `editText`'s read-match-write critical section would have to move wholesale into the child to stay atomic; and the threat surface (trusted operations, untrusted path argument) does not need a kernel — the fence in trusted code is the complete answer, while untrusted-code isolation stays on `ctx.shell`.
- **Per-family policy config with a load-time consistency check** — rejected: two homes for one fact, patched by a check that must enumerate every future enforcing family; the policy service makes drift inexpressible instead of detected.
- **Keep the override event in `dsh-shell` as `shell/sandbox-mode`** — rejected: the event is policy state consumed by two families; leaving it bash-named forces `dsh-fs-sandbox` to depend on bash vocabulary. Pre-release, the rename is a same-change move with snapshot re-records, no shims.
- **Escalation choreography imported from the approval/agent packages into `dsh-sandbox`** — rejected: it would invert the layering (a base vocabulary package depending on UI/agent packages). The structural approver keeps the logic single-sourced in `dsh-sandbox` while the dependencies stay in the tool layer that already holds them.
- **A consolidated operation-options object on the fs seam** — rejected on friction: it would move the established cancellation parameters into another object. A trailing optional `SandboxExecutionPolicy` matches bash's carry-and-ignore pattern and keeps the existing positional API intact.
- **Extra writable-root grants on `SandboxPolicy` now** — deferred unchanged: `writableRoots()` derives from the mode meaning today; ad-hoc grants are an escalation-scope question the sandbox RFC left open.

## Consequences

What shipped — the tiers in § Testing hold each:

- Under `read-only`, metadata, text, byte, and listing operations succeed only under the workspace and platform temp roots; mutations are denied.
- Under `workspace-write`, reads and mutations succeed under the workspace and platform temp roots and are denied outside. Re-canonicalization rejects a workspace symlink whose target is outside and delegates with the checked identity rather than a stale target key.
- A denied fs operation retried once with `sandbox_permissions` + `justification` prompts through the composed approval chain; a grant runs exactly that call under the wider mode; rejected/cancelled/unavailable each produce their verbatim fail-closed text and execute no filesystem operation.
- One `permission` preset switch governs both families: after a session switches modes, the next bash call and the next fs operation both honor the new mode from the same `sandbox/mode` fold.
- Concurrent sessions with different cwd roots carry different policies through the same service instances; neither family caches one session's root for the next call.
- A direct enforcing `ctx.fs` operation with no per-call stamp is confined at the deployment default.
- The escalation fields on `read`/`read_image`/`write`/`edit` exist exactly when the mounted `ctx.fs` confines, absent under `dsh-fs-local`.
- `agent-loop` is untouched — everything rides `ctx.sandboxPolicy`, the `ctx.fs` seam, `SessionEventMap` merging, and the tool-execution pipeline.

Costs and accepted limits:

- **The fs fence is a policy boundary, not a kernel one.** Its threat surface is model-chosen paths, not adversarial host processes; the residual resolve-to-syscall TOCTOU is narrowed, not eliminated, and the README says so. Kernel boundaries remain bash's.
- **Platform temp areas remain broad roots.** Per-session private temp storage is required before temp access can be narrower without breaking ordinary tools.
- **`dsh-bash-sandbox` gains a hard dependency on `ctx.sandboxPolicy`.** Every sandboxed composition adds one `cordis.yml` entry or fails loud at load — the intended pre-release foundation move; the examples update in the same change.
- **Fence-vs-runner parity is derived, not asserted.** The fs fence and the Seatbelt profile both take their writable set from `writableRoots`, and a parity unit test pins the sets; a runner profile changing its writable set without that function would drift.
- **The marker and escalation teaching now serve two families.** A wording change is a coordinated edit behind one builder in `dsh-sandbox`; the duplication gate and pinned snapshots hold it single-sourced, at the cost that fs and bash cannot deliberately diverge in phrasing without splitting the builder.

## Testing

- Unit: `dsh-sandbox` pins readable and writable root derivation plus the shared escalation flow. `dsh-fs-sandbox` exercises every read primitive, both no-follow symlink directions, outside-root refusals, fresh-identity delegation, mutations, and per-call overrides on a real filesystem. `dsh-tool-fs` pins policy propagation, schema advertisement, denial mapping, and approval outcomes; `dsh-tool-str-replace-editor` exercises an outside-workspace view through the assembled provider.
- Keyless e2e: one real Cordis context creates two agents with different session cwd roots, runs the shipped bash and fs tools concurrently, and world-verifies that own-project writes land while both cross-project writes are denied.
- Snapshot: the acp-agent example composes `dsh-sandbox-policy` + `dsh-fs-sandbox`; the pinned header carries the fs escalation fields and the `sandbox/mode` event name, re-recorded once.
