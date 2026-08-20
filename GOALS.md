# Privacy-Oriented DeepSeek Harness Fork — Goals

## Mission

Build a privacy-oriented fork of DeepSeek Harness where privacy is an architectural property rather than a collection of optional switches.

The fork should follow one core rule:

> No data should leave the user's machine unless it is explicitly required for a user-selected provider request or the user has clearly opted in to that specific data flow.

The default configuration should minimize persistent identifiers, outbound network access, sensitive local storage, and agent visibility into secrets.

---

## Core Principles

### 1. Privacy by Default

The safest configuration must be the default.

A fresh installation should:

- disable telemetry,
- avoid persistent cross-session identifiers,
- disable web search,
- deny arbitrary agent network access,
- restrict file reads to the active workspace and approved temporary directories,
- avoid exposing credential paths or session-log paths to agent-controlled processes,
- retain only the local data required for normal operation.

Users should not need environment variables, undocumented configuration, or manual hardening to reach the privacy-preserving state.

### 2. Explicit Egress

Every outbound request should have an explicit purpose, destination, and policy decision.

The system should distinguish between:

- main model requests,
- web search,
- title generation,
- compaction,
- feedback,
- telemetry,
- plugin network access,
- shell/process network access.

All non-essential egress should be disabled or require explicit approval.

### 3. Least Privilege

Agent-controlled tools should receive only the capabilities required for the current task.

Filesystem, network, process, and credential access should be separate permissions rather than consequences of running as the same OS user.

### 4. No Hidden Identity

The default installation should not create or transmit a persistent user identifier.

Provider requests should not include cross-session tracking identifiers unless the user explicitly enables them.

### 5. Local Does Not Automatically Mean Private

Sensitive local state should be protected against:

- other local users,
- accidental disclosure,
- malicious or prompt-injected agent behavior,
- excessive retention.

Local session history and credentials should be treated as sensitive data.

### 6. Privacy Must Be Testable

Privacy guarantees must be covered by automated tests.

A future code change should not be able to introduce a new outbound data path or sensitive filesystem access without failing CI.

---

## Per-Goal Completion Requirements

Every goal in this document is incomplete until its implementation is documented and committed.

For **each individual goal**:

1. Implement the goal and its required tests.
2. Update the repository `README.md` to reflect any user-visible behavior, privacy guarantee, configuration option, security boundary, limitation, or migration step introduced by the goal.
3. Update any additional technical documentation affected by the change.
4. Verify that the goal's acceptance criteria and relevant privacy-regression tests pass.
5. Review the final diff to ensure it does not introduce undocumented network, identity, credential, filesystem, telemetry, or persistence behavior.
6. Create a dedicated Git commit for the completed goal.

Each goal should therefore end in a repository state that is:

```text
implemented
tested
documented
README updated
reviewed
committed
```

Commits should be scoped to the goal where practical and use a descriptive message, for example:

```text
privacy: remove persistent provider identifiers
privacy: sandbox agent network access
privacy: restrict filesystem reads to workspace
privacy: add host credential broker
```

Do not consider a goal complete while its changes remain only as uncommitted working-tree modifications.

---

# Priority Goals

## P0 — Remove Persistent Provider Tracking

Remove the default use of a persistent harness-wide anonymous user ID in provider requests.

### Requirements

- Do not create `$DSH_HOME/.anonymous-user-id` during normal operation.
- Do not send `x-deepseek-harness-user-id` by default.
- Do not send persistent cross-session identifiers to model providers.
- Avoid sending a provider-visible session identifier unless required for a specific feature.
- If correlation is explicitly enabled, prefer:
  - process-scoped identifiers, or
  - session-scoped random identifiers.

### Acceptance Criteria

A clean installation can run multiple sessions without creating or transmitting a stable cross-session identifier.

---

## P0 — Enforce Network Isolation for Agent-Controlled Processes

The agent sandbox must control network access independently from filesystem permissions.

### Default Policy

```text
Main model provider:      allowed
Agent shell network:      denied
Plugin network:           denied or ask
Web search:               disabled
Telemetry:                disabled
Feedback upload:          disabled
```

### Requirements

- Add a dedicated network permission boundary.
- Deny arbitrary outbound connections from model-controlled shell processes by default.
- Support explicit escalation.
- Support destination allowlists where practical.
- Keep host-owned provider traffic separate from agent-owned network traffic.

### Acceptance Criteria

A default agent session cannot use shell tools to contact an arbitrary internet host.

---

## P0 — Restrict Filesystem Reads

The default sandbox should protect reads as well as writes.

### Default Access

```text
Workspace:                read/write
Session temp directory:   read/write
Everything else:          denied
```

### Sensitive Locations

Access should be denied by default to locations such as:

```text
$DSH_HOME
~/.ssh
~/.gnupg
~/.aws
~/.config
browser profiles
credential stores
unrelated repositories
```

### Requirements

- Separate read and write permissions.
- Prevent workspace prompt injection from reading unrelated local secrets.
- Require explicit approval for access outside the allowed roots.

### Acceptance Criteria

A model-controlled filesystem or shell operation cannot read `$DSH_HOME/.credentials.yaml`, `~/.ssh`, or arbitrary files outside the active workspace without explicit approval.

---

## P0 — Isolate Credentials Behind a Host Credential Broker

Provider credentials must remain outside the agent-controlled execution domain.

### Target Architecture

```text
Agent
  |
  | credential reference
  v
Host Credential Broker
  |
  | injects provider authentication
  v
Provider
```

### Requirements

- The agent must never receive raw provider API keys.
- Prefer OS-backed secret stores where available.
- Do not expose credential file paths to model-controlled processes.
- Do not expose `$DSH_HOME` unless a tool genuinely requires it.
- Do not expose session persistence paths to shell tools by default.

### Acceptance Criteria

Running `env`, filesystem enumeration, or ordinary shell tools does not reveal provider credentials or their storage location.

---

# P1 — Redesign Telemetry

Telemetry should contain no user content by default.

### Modes

Replace broad session-sharing semantics with a smaller model:

```text
OFF
ANONYMOUS_METRICS
DIAGNOSTICS_EXPORT
```

### Anonymous Metrics May Include

- application version,
- operating-system family,
- model identifier,
- latency,
- token counts,
- error categories,
- tool names.

### Anonymous Metrics Must Not Include

- prompts,
- model responses,
- tool arguments,
- tool output,
- filenames,
- absolute or relative workspace paths,
- repository names,
- session IDs,
- persistent user IDs,
- file contents.

### Diagnostics

Diagnostics should be manually exported to a local file for review before sharing.

### Acceptance Criteria

Enabling anonymous metrics cannot transmit session content.

---

## P1 — Decouple Feedback From Session Sharing

Feedback must not implicitly release session history.

### Requirements

`/feedback` should submit only the feedback content and minimal explicitly documented metadata.

Example:

```json
{
  "text": "Search was slow.",
  "version": "...",
  "platform": "linux"
}
```

It must not automatically include:

- earlier prompts,
- tool output,
- workspace paths,
- conversation history,
- unrelated session events.

### Acceptance Criteria

Submitting feedback cannot cause the session transcript or a session prefix to be uploaded.

---

## P1 — Introduce a Central Egress Policy

All external data flows should pass through a common policy layer.

### Target Architecture

```text
LLM ----------------------+
Web Search ---------------+
Title Generation ---------+
Compaction ---------------+--> PrivacyEgressController --> Network
Telemetry ----------------+
Feedback -----------------+
Plugins ------------------+
```

### Every Request Should Declare

- purpose,
- destination,
- data classification,
- whether user content is included,
- whether workspace content is included,
- whether persistent identifiers are included.

### Policy Outcomes

```text
ALLOW
DENY
ASK
```

### Acceptance Criteria

A new network-capable component cannot bypass the central egress policy in the supported runtime.

---

## P1 — Disable Web Search by Default

Web search is an external disclosure channel and should require explicit enablement.

### Requirements

- Disable web search in the default bundle.
- Ask before the first external search.
- Support:
  - allow once,
  - allow for this session,
  - always allow this provider,
  - cancel.
- Clearly show the destination receiving the query.

### Acceptance Criteria

A fresh installation cannot send a web-search query without user action.

---

## P1 — Make Auxiliary LLM Calls Visible and Controllable

Secondary model calls must be treated as external data flows.

This includes:

- session-title generation,
- compaction,
- summarization,
- search requests,
- future auxiliary model features.

### Requirements

- Make each auxiliary call type independently configurable.
- Default title generation to local or disabled where feasible.
- Keep compaction on the same provider by default unless explicitly configured otherwise.
- Route all auxiliary calls through the central egress policy.
- Document exactly what context each auxiliary request receives.

### Acceptance Criteria

Users can determine which provider receives each class of auxiliary request.

---

# P2 — Encrypt Local Session Storage

Local session history should be treated as sensitive data.

### Requirements

- Support encryption at rest.
- Prefer a master key stored in:
  - macOS Keychain,
  - Windows DPAPI / Credential Manager,
  - Linux Secret Service or equivalent.
- Never store the encryption key next to the session database.
- Preserve crash recovery and append durability where possible.

### Acceptance Criteria

Copying the session storage directory alone is insufficient to read session contents.

---

## P2 — Add Retention and Secure Erasure Controls

The system should not retain session history indefinitely by default.

### Example Policy

```text
sessions:        30 days
diagnostics:      1 day
temporary logs:   7 days
```

### Requirements

- Add configurable retention policies.
- Add a command such as:

```text
dsh privacy erase
```

- Allow users to erase:
  - sessions,
  - attachments,
  - diagnostics,
  - identifiers,
  - cached metadata.

### Acceptance Criteria

Users can delete all locally retained session-related data through one documented workflow.

---

## P2 — Add a Privacy Dashboard

Users should be able to understand the effective privacy state without reading source code or environment variables.

### Example

```text
Privacy

Network
  Model provider          DeepSeek        ON
  Web search              OFF
  Agent network           BLOCKED
  Plugin network          ASK

Storage
  Session history         Encrypted
  Retention               30 days
  Credentials             OS keychain

Identifiers
  Persistent user ID      NONE
  Provider session ID     NONE

Diagnostics
  Telemetry               OFF
  Feedback sharing        OFF
```

### Requirements

- Show the effective configuration rather than only stored settings.
- Clearly identify every enabled external destination.
- Surface any privacy-reducing configuration changes.

---

# Architectural Components

## NetworkBroker

Own all outbound network access from agent-controlled code.

Responsibilities:

- destination enforcement,
- allowlists,
- per-session approvals,
- audit events,
- denial handling.

## CredentialBroker

Own provider secrets.

Responsibilities:

- secret retrieval,
- secure storage,
- provider authentication,
- preventing raw secret exposure to agents.

## WorkspaceSandbox

Own filesystem and process confinement.

Responsibilities:

- workspace read/write rules,
- read isolation,
- temporary-directory access,
- sensitive-path denial,
- controlled escalation.

## PrivacyEgressController

Own application-level outbound data decisions.

Responsibilities:

- classify requests,
- apply policy,
- request consent,
- record privacy-safe audit metadata,
- prevent hidden outbound channels.

---

# Privacy Audit Log

The fork should expose a local, privacy-safe record of outbound activity.

Example:

```text
20:14:03 model-request
  destination: api.deepseek.com
  session-content: yes
  workspace-content: possible
  persistent-id: no

20:14:12 web-search
  blocked by policy

20:14:31 shell-network
  destination: registry.npmjs.org
  denied
```

The audit log itself must not duplicate prompts, source code, secrets, or tool outputs.

---

# Automated Privacy Tests

Privacy guarantees must be part of CI.

Required categories include:

### Network

- A default agent turn contacts only the configured model endpoint.
- Shell processes cannot reach arbitrary external hosts.
- Disabled web search produces no network request.
- Disabled telemetry produces no telemetry request.

### Identity

- A clean installation creates no persistent user identifier.
- Provider requests contain no persistent user ID.
- Multiple sessions cannot be correlated through a fork-generated stable identifier.

### Filesystem

- Workspace reads succeed.
- Workspace writes succeed under `workspace-write`.
- Reads outside the workspace are denied by default.
- Credential stores cannot be read by agent tools.
- Sensitive home directories are inaccessible by default.

### Credentials

- `env` inside agent-controlled shell processes contains no provider keys.
- Provider requests still authenticate correctly through the credential broker.

### Telemetry

- Anonymous telemetry fixtures contain no message content.
- Telemetry serialization rejects forbidden fields.
- Feedback never includes transcript data.

### Regression

CI should fail when a new direct network client is introduced outside approved networking packages.

---

# Non-Goals

The fork does not aim to:

- make remote LLM usage private from the selected model provider,
- prevent users from explicitly granting broad filesystem or network access,
- prevent intentionally installed trusted plugins from receiving explicitly granted capabilities,
- provide anonymity against network-level metadata such as the user's public IP address when contacting a remote provider,
- guarantee privacy when running with unrestricted `danger-full-access`.

The goal is to make data exposure deliberate, minimal, observable, and enforceable.

---

# Definition of Done

The privacy-oriented fork is considered successful when a fresh installation satisfies all of the following:

1. No telemetry is sent.
2. No persistent cross-session user identifier is created or transmitted.
3. Only the configured model provider can be contacted automatically.
4. Agent-controlled processes have no network access by default.
5. Agent-controlled tools cannot read outside the active workspace by default.
6. Provider credentials are inaccessible to agent-controlled code.
7. Web search requires explicit enablement.
8. Auxiliary LLM requests are visible and policy-controlled.
9. Feedback cannot release session history.
10. Session storage can be encrypted and automatically expired.
11. Users can inspect all effective privacy-relevant settings in one place.
12. CI verifies the critical privacy boundaries.
13. Every completed goal has corresponding `README.md` updates where applicable.
14. Every completed goal ends with its own reviewed Git commit.

---

# Suggested Implementation Order

1. Remove persistent provider identifiers.
2. Introduce agent network isolation.
3. Enforce filesystem read confinement.
4. Add the credential broker.
5. Introduce the central egress controller.
6. Remove content-bearing telemetry.
7. Decouple feedback from session sharing.
8. Disable web search by default.
9. Route auxiliary model calls through egress policy.
10. Add encrypted persistence and retention.
11. Add the privacy dashboard and local egress audit.
12. Expand CI with privacy-regression tests.

The first four items establish the core trust boundaries. Later work should build on those boundaries rather than introduce separate feature-specific privacy switches.
