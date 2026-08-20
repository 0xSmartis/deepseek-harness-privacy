# Agent Note: DeepSeek Web search in shipped compositions

Status: implemented

English | [中文](2026-07-31-web-default-search.zh.md)

## Problem

The harness had a complete Web capability family—provider registry, DeepSeek/Exa/Perplexity search providers, local fetch, stable model tools, and structured result presentation—but the shipped `dsh web` composition mounted none of it. The model could not discover current information unless a deployment supplied a custom overlay. Merely mounting the existing DeepSeek provider would not complete the WebUI path: the Models page stores `DEEPSEEK_API_KEY` through `ctx.credentials`, while the search provider froze only the process environment at plugin load, so a key entered or rotated in the running UI would not reach search.

## Decision

`packages/bundle/base/cordis.patch.yml` mounts `dsh-web` with `searchProvider: deepseek-official`, keeps `dsh-web-search-deepseek` disabled, and mounts `dsh-tool-web` with `fetch: false` and `searchTimeoutMs: 60000`. It does not mount `dsh-web-fetch-http` or select a fetch provider. TUI, browser, and headless sessions retain the stable `web_search` schema, but a fresh profile has no search provider and therefore sends no query. The [auxiliary-egress default](../simplification/2026-08-20-disable-undisclosed-auxiliary-egress.md) requires a deployment to re-enable the provider after disclosing its Messages destination and query input. The explicit provider id keeps selection independent of registration order. The one-minute shipped budget covers the authorized auxiliary request plus server-side retrieval while leaving `dsh-tool-web`'s provider-neutral 30-second default unchanged for custom compositions.

DeepSeek search uses the same `DEEPSEEK_API_KEY` credential reference as the official conversation adapter. The provider resolves that reference inside every search through the optional `ctx.credentials` service; only a composition without the seam falls back to the launching process environment, and a non-empty literal `apiKey` remains the programmatic last resort. A stored or rotated Web Models key therefore reaches the next search without restarting or retaining the value on the provider. Because `WebSearchProvider.available()` is synchronous, it treats an installed resolver as locally usable and missing dynamic credentials fail the operation with the provider-specific `WEB_PROVIDER_CREDENTIAL_MISSING` code while the stable tool schema stays registered.

Search keeps its endpoint distinct from chat completions: `DEEPSEEK_SEARCH_BASE_URL` overrides the Anthropic-compatible base, while `DEEPSEEK_BASE_URL` continues to configure conversation requests. Each `web_search` performs an auxiliary DeepSeek Messages call with the native search server tool. Immediately before dispatch, the provider appends a log-only `web/deepseek-search-llm-request` event to the initiating Agent session with the resolved endpoint, API version, and exact secret-free JSON body. Credential preflight remains provider-local and races caller cancellation; neither concern expands the generic Web or credentials seams.

The opt-in search path does not create a Web-specific permission policy. Once its provider is enabled, `web_search` executes outside the shell/filesystem sandbox and approval presets, following `dsh-tool-web`'s existing contract. The composition does not mount `web_fetch` or a local fetch provider, so it does not grant model-selected arbitrary URL retrieval. The shipped `workspace-write` default governs file mutations only; a restricted-network product stance requires a `tools/pre-execute` policy or capability-specific network confinement rather than implying that filesystem access mode governs Web calls.

## Alternatives considered

**Remove `web_search` while its provider is disabled.** Rejected because the stable schema and provider selection remain separate extension roles, and retaining the consumer lets one provider override enable the existing capability. A call before authorization fails locally instead of sending a query.

**Read `$DSH_HOME/.env` from `cordis.yml` or hoist it into `process.env`.** Rejected because the credential provider owns that document, environment values are read-only overrides, and hoisting would make stored keys unrotatable while bypassing the audited secret boundary.

**Freeze `process.env.DEEPSEEK_API_KEY` at provider load.** Rejected because the Web Models page writes through `ctx.credentials`; the product's documented first-run path must make the next operation work without a restart.

**Keep Web tools in the Web-only bundle.** Rejected because it preserves an unexplained tool-roster difference between TUI and Web/headless. The rows are not surface-specific, so the shared base bundle is their one home; the [tool-roster decision](2026-07-31-even-out-shipped-tool-rosters.md) records the shared composition.

**Raise `dsh-tool-web`'s provider-neutral timeout.** Rejected because custom providers and deployments own different latency expectations; the shipped DeepSeek composition owns this deployment budget.

**Enable search and fetch together.** Rejected because default `web_fetch` would allow model-selected anonymous outbound HTTP(S) retrieval to arbitrary URLs. Search covers discovery; deployments that accept broader retrieval can opt into `dsh-web-fetch-http` and set `dsh-tool-web`'s `fetch` option to `true` in their overlay.

## Consequences

Native model requests on every full shipped surface carry only the `web_search` schema and search-only prompt guidance; Web/headless Code Mode exposes the same schema beneath `run_code`. The prompt tells the model to use returned snippets and never advertises the disabled `web_fetch` tool. A fresh profile's search call fails without a provider and sends nothing. Once explicitly enabled, search adds a complete auxiliary model call and may use the native server tool multiple times; its exact secret-free request remains reconstructable from the initiating session log. The Web snapshot lane opts into the real DeepSeek provider against a local Messages fixture, asserts the durable auxiliary request and structured result, and pins the settled browser presentation. Composition smokes pin the shared `web_search` roster and absence of `web_fetch`; the base-bundle test pins the provider disabled; provider tests pin missing, stored, and rotated credential behavior plus literal and ambient compatibility.
