# @deepseek-ai/dsh-shell-env

[English](README.md) | 中文

工具无关的 shell 环境插件：拥有 `ctx.shellEnv` 注册表，管理受信任的、每次执行收集的 `DSH_*` 变量，供模型可见的 shell 工具（`dsh-tool-bash`、`dsh-tool-pwsh`）收集进每次 shell 调用的环境。内置 shell 事实（`DSH_SHELL=1`、`DSH_SESSION_ID`）归注册表自身所有；其他受信任插件可以注册额外的可枚举事实，注册随插件纤维（fiber）释放，重复所有权或未声明的运行时键会响亮失败。

包根导出 Cordis 插件约定（`name`、`inject`、`apply`）以及 `ShellEnvRegistry` 服务类及其 contributor 类型；消费方在加载本插件后使用 `ctx.shellEnv`。

## Managed environment

每次前台与后台模型 shell 调用都会收到一份新收集的受信任 `DSH_*` 环境。`DSH_SHELL=1` 标识受管理的子进程；带 agent（智能体）的调用额外收到会话作用域的 `DSH_SESSION_ID=agent.session.header.id`。默认注册表不会公开 Harness 主目录、持久化、凭据或其他文件系统位置。

`ctx.shellEnv` 负责收集。其他受信任插件可以显式注册一个受 effect 作用域约束的 contributor，带有稳定名称、已声明的键／描述以及 `resolve(execution: ToolExecution)`；重复所有权与未声明的运行时键会响亮失败，而 `list()` 只枚举声明、不执行 provider。Harness 内置键保留 `DSH_SHELL` 与 `DSH_SESSION_ID`。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-shell-env'

export const inject = ['shellEnv']

export function apply(ctx: Context): void {
  ctx.shellEnv.register({
    name: 'deployment-region',
    variables: { DSH_DEPLOYMENT_REGION: { description: 'Current deployment region.' } },
    resolve: execution => execution.agent === undefined ? {} : { DSH_DEPLOYMENT_REGION: 'cn-north' },
  })
}
```

覆盖层根据当前 `ToolExecution` 计算，并通过专用的 `ShellExecRequest.dshEnv` 通道传递。本地执行器在合并该快照前移除所有继承的 `DSH_*`，因此环境中的 `DSH_HOME`、会话日志位置或陈旧身份不会进入模型控制的进程。`process.env` 永不被修改。shell 工具的描述只教授通用的 `$DSH_*` 约定，而不是点名存储相关变量或添加常驻的 system-prompt 段落。

## Model Experience

通过 shell 工具（`dsh-tool-bash`、`dsh-tool-pwsh`）间接产生影响；这些工具会把该注册表的受管 `DSH_*` 快照收集进每次 shell 工具调用。

#### KV Cache effect

不会直接导致缓存失效；任何请求前缀变更均由上述消费方负责。

## Known Limitations and Deferred Work

- **`list()` 只枚举 contributor 声明的变量** — 注册表自有的内置键（`DSH_SHELL`、`DSH_SESSION_ID`）不包含在内，因此诊断、prompt 或 UI 代码不得把 `list()` 当作完整的环境目录。
