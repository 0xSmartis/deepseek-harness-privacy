# Agent Note: reference-only provider request headers

Status: implemented

English | [中文](2026-08-20-reference-only-provider-headers.zh.md)

## Problem

The pi-ai provider profile accepted `headers: Record<string, string>`. A deployment could therefore put `Authorization`, `api-key`, or another credential directly in `cordis.yml` or `settings.yaml`. The settings descriptor preserved and rendered those strings because the schema could not distinguish a public header from a secret. The resolver also spread unknown direct-composition fields into the pi-ai provider builder, so the already removed `apiKey` field still worked when an untyped configuration supplied it. Both paths contradicted the [request-level credential decision](2026-07-29-request-level-llm-config-credentials.md): provider configuration was meant to name credential references while literal values lived only behind the credential service.

The adapter needs custom authentication headers for gateways whose credentials do not fit pi-ai's `apiKey` option. Some SDK integrations also require an explicit empty header to suppress a default, such as clearing `Authorization` while an Azure-style `api-key` header carries authentication. Removing all header configuration would close the leak but drop those supported routes.

## Decision

Provider profiles carry no literal request-header values. `credentialHeaders` maps each HTTP header name to `{ credentialEnv, scheme? }`: `credentialEnv` is validated as a `CredentialRef`, resolved through `ctx.credentials` or the trusted launch environment for each request, and never enters the resolved profile as a value. `scheme` is non-secret HTTP token syntax and prefixes the credential with one space. `emptyHeaders` carries names only and emits an empty value for SDK-default suppression.

Profile resolution validates header names and schemes as HTTP tokens, rejects case-insensitive duplicate names across both fields, and rejects Harness-owned attribution names. A missing reference fails before network I/O with `MISSING_CREDENTIAL`; a blank or non-header-safe value fails with `INVALID_CREDENTIAL`. Both diagnostics name the route, header, and reference without including any part of the resolved credential. The adapter resolves the API key and credential headers after capturing one immutable profile snapshot, then passes only those request-local values to pi-ai.

The pre-release `apiKey` and `headers` fields fail load with migration guidance. There is no compatibility alias or automatic interpretation of a literal string as a reference. This decision partially supersedes the literal-header realization in the [provider-routed adapter decision](2026-07-14-provider-routed-llm-adapters.md) and the configured `Authorization` workaround in the [declared-provider catalog decision](2026-08-03-pi-ai-declared-provider-catalog.md); their provider routing, catalog, and authentication rationale remains active.

## Alternatives considered

- **Redact known authentication names.** Header names are extensible and gateways use private conventions, so a denylist would preserve an unbounded literal-secret path under an unrecognized name.
- **Make literal headers write-only in settings RPC.** The secret would still live in `settings.yaml`, composition dumps, diagnostics that serialize config, and any trusted plugin that reads the section. Masking readers does not restore one host-owned credential store.
- **Remove custom headers entirely.** This is the smallest data model but excludes gateways that require a second credential header and SDK integrations that need an explicit empty override.
- **Store complete `Bearer …` values as one credential.** It keeps secrets out of settings, but mixes a non-secret protocol scheme into credential rotation and prevents the resolver from applying the same format validation to the secret itself. A separate `scheme` field keeps configuration inspectable without exposing the value.

## Consequences

Provider configuration, settings descriptors, generated catalogs, and model-facing configuration tools contain only credential references, header names, and optional schemes. Successful request tests pair wire authentication with the absence of the resolved value from `settings.yaml`; missing and malformed credential tests prove that no request is sent and no value enters the failure. Literal `apiKey` configurations migrate to `apiKeyEnv`; literal header configurations move each non-empty value into the credential store and reference it from `credentialHeaders`, while empty overrides move to `emptyHeaders`.

The credential file remains host-owned sensitive storage, and provider-native ambient authentication still exists when a profile omits `apiKeyEnv`. Filesystem read confinement and an OS-backed credential provider remain separate privacy work; this decision closes the adapter-owned configuration path without claiming those broader protections.
