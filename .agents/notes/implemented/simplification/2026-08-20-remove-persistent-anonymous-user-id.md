# Agent Note: Remove the persistent anonymous user id

Status: implemented

English | [中文](2026-08-20-remove-persistent-anonymous-user-id.zh.md)

## Problem

The harness persists a random UUID in `$DSH_HOME/.anonymous-user-id` and reuses it in three independent paths: direct DeepSeek requests send `x-deepseek-harness-user-id`, OpenTelemetry exports attach Resource `user.id`, and `/feedback` displays the value in its acknowledgement. The value does not contain account data, but its stable lifetime lets every receiving endpoint correlate activity across sessions and process restarts. A configured DeepSeek gateway and a configured telemetry collector receive the same identifier even though neither endpoint selection nor feedback submission grants authority for cross-session tracking.

The shared package also expands the codebase to maintain one behavior whose only purpose is correlation: storage recovery, concurrent creation, in-memory fallback, package invariants, consumer dependencies, documentation, and tests. Calling the value anonymous describes how it is generated, not what a recipient can infer from repeated observations.

## Decision

`@deepseek-ai/dsh-anonymous-user-id` and all three consumers are absent. Direct DeepSeek requests retain mandatory application attribution and the conditional durable session id, but never add a harness-generated cross-session user header. OpenTelemetry Resource identity retains `service.name` and `service.version`, but no user attribute. `/feedback` retains the receiving session id and sharing disclosure without creating or showing another identity.

The removed implementation originally minted a random UUID v4, stored it as a bare line in `$DSH_HOME/.anonymous-user-id`, memoized it by resolved home path, used exclusive creation to settle ordinary concurrent first launches, and fell back to a process-local value when the home was unwritable. That design avoided reversible hostname or network-address derivation and supplied active-user aggregation plus provider-support and feedback correlation. Those operational uses no longer justify giving each configured gateway and collector a stable cross-session handle by default. Calling the UUID anonymous did not constrain correlation at the recipient.

No compatibility package or migration reads an existing file. Old `.anonymous-user-id` files are inert and may be deleted normally. Workspace metadata, generated catalogs, package documentation, base configuration comments, and current-state design documentation do not present the identity as supported behavior.

## Alternatives considered

**Keep the identifier but require explicit opt-in.** This would stop the default privacy violation, but it preserves a package and wire/storage contract for an operational convenience with no user-facing control plane, retention policy, or demonstrated need. A future authorized correlation feature can introduce the narrowest lifetime and destination policy it actually needs.

**Replace it with a process-scoped identifier.** A process id would reduce persistence but would still add undisclosed metadata to provider and telemetry requests and would not reliably correspond to a user or session. The existing session id already supplies request correlation when a model call belongs to a durable session.

**Keep an unused compatibility package or ignore existing files.** The repository is pre-release and has no compatibility promise for this behavior. Leaving the package or migration handling would imply that persistent identity remains a supported concept. Existing `.anonymous-user-id` files are inert after removal and users may delete them normally.

**Derive an identifier from the hostname, network address, or git remote.** Derivation would make the identifier recoverable but also link it to identifying local material and could be reversible. It worsens the privacy property instead of removing the tracking capability.

**Generate separate identifiers for telemetry, feedback, and provider requests.** Independent values would reduce cross-destination correlation but retain undisclosed stable tracking within each destination and restore three pieces of behavior with no user control plane.

## Verification

- Direct-provider wire tests assert that `x-deepseek-harness-user-id` is absent with and without a session id.
- The OpenTelemetry wire test rejects a Resource `user.id` attribute.
- Real provider and feedback compositions prove that authorized requests and accepted feedback leave `.anonymous-user-id` absent.
- Feedback package tests and Web snapshots contain only the receiving session and current sharing disclosure.
- Repository searches and generated-catalog gates keep the deleted package and supported behavior absent; this Note and negative tests retain the removed names only to pin that guarantee.

## Consequences

Operators lose automatic cross-session correlation between provider requests, telemetry, and feedback. Session-local correlation remains available through durable session ids and session records. The change deletes one package and its storage, concurrency, fallback, invariant, dependency, documentation, and test surfaces.

Removing the stable identifier does not by itself make model prompts or explicitly enabled telemetry private; those paths require their own destination, disclosure, minimization, and policy controls. Reintroducing cross-session correlation requires an explicitly authorized feature with a visible destination and purpose, a narrower lifetime where possible, and matching retention and deletion semantics. A provider-support convenience alone is not sufficient.
