# Privacy Goals

## Purpose

This reference defines the fork's intended privacy properties, priorities, and acceptance. It does not track implementation status or replace the [architecture](docs/architecture.md), [subsystem references](docs/subsystems/README.md), or [Agent Notes](.agents/notes/README.md).

The mission is to make privacy an architectural property rather than a collection of optional switches:

> Harness-controlled data leaves the user's machine only for a user-selected model request or after the user authorizes that specific class of data flow.

A fresh installation minimizes persistent identifiers, external access, sensitive storage, and agent access to secrets without manual hardening.

## Scope and threat model

### Protected data

The fork protects prompts, model responses, tool data, workspace content and identity, credentials, session history, diagnostics, local metadata, and persistent identifiers.

### Trust assumptions

- Model output, workspace instructions, fetched content, and agent-controlled child processes are untrusted.
- The operating system, Harness host process, and bundled providers are trusted to enforce their policies. A compromised host or administrator is outside this threat model.
- An installed in-process plugin is trusted because it has host-process authority. Preventing its direct use of Node.js APIs requires plugin isolation.
- A selected remote model provider receives the request content sent to it; the fork minimizes and discloses that content but cannot hide it from the provider.
- Network metadata, backups, snapshots, swap, and crash dumps remain deployment concerns.

External egress means traffic to a remote destination. Loopback traffic between shipped client and host components is not external egress, but it must remain restricted to the local trust boundary.

## Principles

The fork applies privacy by default, explicit egress, least privilege, no hidden identity, protected local state, and automated enforcement tests. Filesystem, network, process, and credential permissions remain independent, and each guarantee is enforced at the lowest component that owns it.

## Required defaults

| Area | Required default | Explicit exception |
|---|---|---|
| Model requests | Only the provider and model selected for the user's request receive its content. | The user selects another provider or authorizes an auxiliary call. |
| Web and auxiliary calls | Web search, title generation, compaction summarization, and similar remote calls do not run without a disclosed authorization. | The user enables the call class with its provider and disclosed input. |
| Agent network | Agent-controlled child processes have no external network access. | A scoped approval grants the required destination and duration. |
| Filesystem | Agent tools access the workspace, approved temporary storage, and required read-only runtime files; sensitive and unrelated user paths remain inaccessible. | A scoped approval grants an additional root for the current operation or session. |
| Credentials | Provider configuration carries references; raw secrets remain in host-owned resolution and are absent from agent environments and tools. | A trusted host plugin explicitly resolves a credential for its operation. |
| Telemetry and feedback | No telemetry or feedback content is uploaded. | The user enables a documented content-free metrics flow or explicitly sends reviewed feedback. |
| Identifiers | No persistent cross-session user identifier is created or transmitted. | A separately documented feature obtains explicit authorization for a narrower identifier lifetime. |
| Local storage | Sensitive files use owner-only access and disclose whether encryption and retention controls are active. | The user deliberately selects a less restrictive storage configuration. |

## Priorities

P0 establishes the safe default required to use the selected model provider. P1 governs optional external capabilities and informed consent. P2 adds defense in depth for local storage and makes the effective privacy state easier to inspect.

### P0 — Remove persistent provider tracking

The default composition must not create `$DSH_HOME/.anonymous-user-id`, send `x-deepseek-harness-user-id`, or transmit another stable fork-generated identifier across sessions. Tests cover multiple sessions, restarts, provider requests, telemetry-disabled startup, and feedback. Authorized correlation defaults to a process- or session-scoped random identifier.

### P0 — Eliminate undisclosed default egress

A clean profile may contact the selected model endpoint for the user's request. Search, remote title generation, telemetry, feedback upload, update checks, and other auxiliary traffic require authorization for their class and destination. An assembled keyless test observes startup, a model turn, title handling, and feedback, permitting only the configured model request.

### P0 — Isolate agent-controlled network access

Agent-controlled child processes have a network policy independent from filesystem permissions; host-owned provider traffic stays outside it. The default denies descendant connections, while an approved retry may grant a bounded destination and lifetime. Supported backends report enforcement completeness and fail closed when the selected mode promises isolation. Platform tests cover remote and loopback targets, descendants, approval, and backend failure.

### P0 — Confine filesystem reads and writes

Model-facing filesystem operations allow the workspace, approved temporary storage, required read-only runtime roots, and explicit grants. Agent processes receive no ambient access or environment hints for `$DSH_HOME`, session storage, browser profiles, credential stores, unrelated repositories, or sensitive home directories. Tests cover tools and shells, reads and writes, symlinks, sensitive paths, approval, and platform enforcement.

### P0 — Keep credentials in the host

Existing [credential references](docs/subsystems/credentials.md) remain the configuration interface. Provider adapters resolve them for host-owned requests; model data, agent environments, tools, diagnostics, errors, events, and readable storage never contain raw values. Tests pair successful authentication with absence from those paths. Configuration may report configured state and source class, but not values or host paths.

### P1 — Declare and enforce bundled egress

One machine-checkable inventory declares every bundled external flow's purpose, destination resolver, trigger, payload categories, identifier use, and authorization. Runtime policy resolves it to allow, deny, or ask before sending. CI rejects undeclared bundled networking and restricts direct network primitives to transport owners. Child-process isolation covers commands; the trust model covers installed in-process plugins.

### P1 — Offer content-free metrics and local diagnostics

Opted-in metrics may contain application version, operating-system family, model identifier, latency, token counts, error categories, and tool names. They exclude prompts, responses, tool data, filenames, paths, repository names, session or user identifiers, and file contents. The product calls them content-free rather than anonymous because metadata can permit correlation. Tests enforce the serialized allowlist and reject session events or content-bearing attributes. Diagnostics export remains a separate, inspectable local artifact.

### P1 — Separate feedback from session sharing

Feedback stays local by default. Sending it transmits only reviewed text and documented metadata, never a transcript, session prefix, tool output, workspace path, or unrelated event. Tests cover every telemetry configuration and require a separate action for session sharing.

### P1 — Make auxiliary model calls visible

Title generation, compaction, search, and future auxiliary model features independently declare their provider, purpose, inputs, and authorization. Changing the main model does not broaden auxiliary egress. Tests verify each assembled call's provider and bounded input; disabled calls use a local fallback or produce no network result.

### P2 — Protect session storage at rest

Session logs, attachments, spill files, diagnostics, and indexes use owner-only access. Persistence supports encryption without storing its key beside the data and reports whether encryption is active. OS-backed secret storage is preferred; headless deployments use an explicit key source or report unencrypted storage. Copying encrypted storage alone must not reveal content.

### P2 — Add retention and complete logical deletion

Retention is finite, configurable, and visible. One workflow deletes session logs and owned attachments, diagnostics, identifiers, indexes, caches, and related artifacts. Tests cover expiry, deletion, restart, and shared artifacts. The product calls this logical deletion, claims cryptographic erasure only through effective key destruction, and makes no physical-erasure promise for SSDs, snapshots, or backups.

### P2 — Expose effective privacy state and egress history

One view shows effective destinations, network enforcement, filesystem roots, credential source classes, identifiers, telemetry, encryption, and retention. It uses resolved behavior and highlights weakened defaults. A local egress history records time, purpose, destination, authorization, and payload classification without content, secrets, filenames, paths, or tool output. Tests compare the view with runtime configuration and reject content-bearing history fields.

## Verification and design ownership

Each goal is complete only when its enforcing package has focused unit or integration coverage, assembled user-visible behavior has a keyless snapshot where required by [testing policy](docs/testing.md), supported operating systems have enforcement coverage, and the owning package and subsystem references document defaults, exceptions, failure behavior, and limitations.

Substantial designs begin as proposed [Agent Notes](.agents/notes/README.md). Implementation status belongs to source, tests, and project tracking rather than this document. Documentation, review, checks, and commit structure follow [AGENTS.md](AGENTS.md) instead of a separate privacy-specific workflow.

## Non-goals

The fork does not aim to:

- hide remote LLM request content from the selected model provider;
- provide anonymity against network metadata such as the user's public IP address;
- withstand a compromised host process, operating-system administrator, or malicious kernel;
- prevent users from explicitly granting broad filesystem or network access;
- sandbox a deliberately installed in-process plugin unless a future plugin-isolation capability says otherwise;
- guarantee deletion from backups, snapshots, swap, crash dumps, or provider systems;
- guarantee privacy while an agent runs with unrestricted host access.

The intended result is data exposure that is deliberate, minimal, observable, and enforceable within these assumptions.
