# Agent Note: 只允许引用的提供方请求 header

Status: implemented

[English](2026-08-20-reference-only-provider-headers.md) | 中文

## Problem

pi-ai 提供方 profile 接受 `headers: Record<string, string>`。因此部署可以把 `Authorization`、`api-key` 或其他凭据直接写入 `cordis.yml` 或 `settings.yaml`。settings descriptor 无法区分公开 header 与机密，会保留并渲染这些字符串。resolver 还会把 direct composition 中未知的字段 spread 到 pi-ai provider builder，因此未类型化配置仍可继续使用已经移除的 `apiKey` 字段。两条路径都与[请求级凭据决策](2026-07-29-request-level-llm-config-credentials.md)相矛盾：提供方配置本应只点名凭据引用，literal 值只存在于凭据服务之后。

对于凭据不适合 pi-ai `apiKey` 选项的网关，适配器仍需支持自定义认证 header。部分 SDK 集成还需要显式的空 header 来抑制默认值，例如在 Azure 风格的 `api-key` header 承载认证时清空 `Authorization`。完全移除 header 配置虽能关闭泄漏，却会丢失这些受支持路由。

## Decision

提供方 profile 不携带任何 literal 请求 header 值。`credentialHeaders` 把每个 HTTP header 名称映射到 `{ credentialEnv, scheme? }`：`credentialEnv` 会被验证为 `CredentialRef`，并针对每次请求通过 `ctx.credentials` 或受信任的启动环境解析；其值绝不进入已解析 profile。`scheme` 是非机密的 HTTP token，以一个空格连接在凭据之前。`emptyHeaders` 只携带名称，并为 SDK 默认值抑制发出空值。

Profile 解析按 HTTP token 语法验证 header 名称与 scheme，拒绝两个字段之间按大小写不敏感规则重复的名称，并拒绝 Harness 拥有的归因名称。缺失引用会在网络 I/O 前以 `MISSING_CREDENTIAL` 失败；空值或 HTTP header 无法承载的值以 `INVALID_CREDENTIAL` 失败。两种诊断都只点名路由、header 与引用，不包含已解析凭据的任何部分。适配器先捕获一份不可变 profile 快照，再解析 API key 与 credential header，最后只把本次请求的值交给 pi-ai。

预发布字段 `apiKey` 与 `headers` 会在加载时失败并给出迁移指引，不提供兼容别名，也不会把 literal 字符串自动解释成引用。本决策部分取代[按提供方路由的适配器决策](2026-07-14-provider-routed-llm-adapters.md)中的 literal-header 实现，以及[声明式提供方 catalog 决策](2026-08-03-pi-ai-declared-provider-catalog.md)里的已配置 `Authorization` 变通；这些记录的提供方路由、catalog 与认证依据仍然有效。

## Alternatives considered

- **对已知认证名称脱敏。** Header 名称可扩展，网关也使用私有约定；denylist 会在无法识别的名称下保留无限制的 literal-secret 路径。
- **在 settings RPC 中把 literal header 设为只写。** 机密仍会存在于 `settings.yaml`、组合 dump、序列化配置的诊断，以及读取该分节的任意受信任插件中。遮蔽读取方不能恢复唯一的 host-owned 凭据存储。
- **完全移除自定义 header。** 这是最小的数据模型，却会排除需要第二个凭据 header 的网关，以及需要显式空覆盖的 SDK 集成。
- **把完整的 `Bearer …` 值存成一条凭据。** 这能使机密离开 settings，但会把非机密协议 scheme 混入凭据轮换，也使 resolver 无法对机密本身应用同一套格式验证。独立的 `scheme` 字段让配置在不暴露值的前提下仍可检查。

## Consequences

提供方配置、settings descriptor、生成 catalog 与面向模型的配置工具只包含凭据引用、header 名称与可选 scheme。成功请求测试同时证明 wire 认证成功，且已解析值不在 `settings.yaml` 中；缺失与格式错误凭据测试则证明没有请求发出，失败中也没有该值。Literal `apiKey` 配置迁移到 `apiKeyEnv`；literal header 配置把每个非空值迁移到凭据存储，再由 `credentialHeaders` 引用，空覆盖则迁移到 `emptyHeaders`。

凭据文件仍是 host-owned 的敏感存储；当 profile 省略 `apiKeyEnv` 时，提供方原生环境认证也仍然存在。文件系统读取约束与 OS-backed 凭据提供方属于独立的隐私工作；本决策只关闭适配器拥有的配置路径，不声称已经提供这些更广泛的保护。
