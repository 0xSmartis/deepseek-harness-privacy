# Agent Note: Disable undisclosed auxiliary egress

Status: implemented

English | [中文](2026-08-20-disable-undisclosed-auxiliary-egress.zh.md)

## Problem

The shipped composition can issue remote requests beyond the conversation-model call a user selected. A first-prompt title provider sends the first human message to a model after the main turn starts, automatic compaction sends conversation context to a summarization route under pressure or after an overflow, and `web_search` sends model-chosen queries to a distinct DeepSeek Messages endpoint. These calls are logged and use configured credentials, but mounting them by default does not establish that the user authorized their purpose, destination, or input.

Telemetry already resolves to `DISABLED` on a clean profile and feedback records into the local session log in that mode. No bundled automatic update checker exists. The remaining default auxiliary model paths therefore determine whether a clean profile's only remote content flow is the selected conversation request.

## Decision

The shared base bundle keeps the deterministic session-title service active and disables `session-title-llm`. It keeps the provider-neutral Web service and stable `web_search` consumer available, but disables the shipped `web-search-deepseek` provider. A search attempt without an authorized provider produces no network result. Deployments opt into either provider row explicitly and disclose the destination and input described by that row: the first eligible human prompt for title generation, or search queries for the configured Anthropic-compatible Messages base URL.

`dsh-compaction-basic` resolves omitted `auto` to `false`. The base bundle and every full shipped agent preset also state `auto: false`, keeping the privacy choice visible at the composition site. The compaction service and `/compact` command remain mounted: a human can deliberately request one summary, while pressure checks and context-overflow recovery do not start an auxiliary call. Enabling `auto: true` authorizes automatic summaries carrying the replayed conversation prefix to the configured summarization provider/model or, when those overrides are empty, the conversation route.

The telemetry row remains mounted with clean-profile mode `DISABLED`; that mode creates no exporter and `/feedback` stays local. `DSH_TELEMETRY_MODE=FULL` or `FEEDBACK_ONLY` remains an explicit deployment opt-in to the configured OTLP destination. No disabled path gains a compatibility shim, implicit credential trigger, or fallback remote provider.

The assembled Web feedback scenario boots the real base and Web bundle layers, runs exactly one replay-backed conversation request, observes a fallback `session/title`, rejects any `session/title-llm-request`, records `/feedback` under disabled sharing, and requires the replay script to be fully consumed. The base-bundle test separately pins the disabled title and search rows, disabled automatic compaction, and disabled telemetry expression. Provider-specific tests retain the authorized title, search, compaction, and telemetry paths.

## Alternatives considered

**Keep auxiliary calls enabled because they use the selected credential.** A credential proves that the host may authenticate to an endpoint; it does not authorize a second purpose or disclose which subset of session data that purpose receives. Convenience does not make the extra flow part of the user's conversation request.

**Remove the auxiliary capabilities entirely.** Explicitly authorized titles, search, compaction, and telemetry remain useful. Keeping their providers and consumers preserves the extension seams without granting remote traffic to a fresh profile.

**Keep automatic compaction for context-overflow recovery only.** Overflow recovery still sends conversation context in a second model request and may change the destination through summarization configuration. Failing the original request is preferable to silently broadening egress; a deployment can enable the complete automatic policy after disclosure.

**Disable manual `/compact` as well.** The command is a direct human action whose documented result requires a model summary. Removing it would not strengthen the unattended default and would discard a deliberate recovery path. It remains distinct from automatic pressure and overflow listeners.

**Add a general runtime ask/allow policy in this change.** A machine-readable egress inventory and central runtime decision layer are the P1 enforcement design. Default-off provider and listener composition closes the immediate P0 leak without introducing a partial policy vocabulary that later transports would bypass.

## Verification

- The base patch test pins `session-title-llm` and `web-search-deepseek` as disabled, `compaction-basic.config.auto` as false, and the clean telemetry mode as `DISABLED`.
- Compaction configuration tests pin `auto: false` when omitted and require explicit `auto: true` in automatic pressure and overflow cases.
- The keyless assembled Web scenario pins one conversation request, fallback title handling, absence of a title-model request, and local feedback with disabled sharing.
- The authorized Web-search assembled scenario explicitly re-enables the provider and supplies a loopback Messages destination; focused provider tests retain the other explicit call paths.

## Consequences

Fresh profiles lose automatic model-polished titles, automatic context-pressure recovery, and immediately usable Web search. They retain local fallback titles, deliberate manual compaction, stable Web tool schemas, local feedback, and the selected conversation-model call. A model may see `web_search` while no provider is authorized and receive a provider-unavailable result if it calls the tool.

The change establishes a safe default, not the final authorization system. It does not inventory every transport, present an interactive approval, separate feedback upload from session sharing, or make auxiliary calls independently visible in product settings. Those remain P1 work. Re-enabling a provider or `auto` without a disclosure is a deployment policy error rather than an implicit product default.
