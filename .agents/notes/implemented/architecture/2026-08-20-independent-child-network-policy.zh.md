# Agent Note：独立的子进程网络策略

Status: implemented

[English](2026-08-20-independent-child-network-policy.md) | 中文

## 问题

进程沙箱原本只管控文件系统效果。以 `read-only` 或 `workspace-write` 运行的命令仍可打开远程与 loopback 连接，而切换到 `danger-full-access` 会完全绕过 runner。文件系统权限既无法决定预期网络权限，也无法保证后代进程继承网络限制。通用批准路径可以为一次调用扩大文件访问，但不能命名或强制执行获批网络目标。

## 决策

在完整逐调用沙箱策略中加入网络策略，但不将其并入 `SandboxMode`。新策略默认拒绝 Internet 协议连接，同时保留本地 Unix 域 IPC。沙箱 shell 执行器在文件或网络策略需要强制执行时都会调用 `ctx.sandbox`；`danger-full-access` 只绕过文件限制。宿主拥有的提供方请求不经过 `ctx.shell`，因此不属于该策略。

本地提供方会对包装后的进程及其每个后代执行拒绝策略。Bubblewrap 创建私有网络 namespace，Seatbelt 拒绝 IP 网络操作，Landlock launcher 在 `exec` 前安装继承式 seccomp 过滤器，拒绝非 Unix 套接字与 `io_uring_setup`。无法强制执行所选网络策略的后端会在命令运行前以 `SANDBOX_UNAVAILABLE` 失败。文件与网络完整性分别报告，避免部分文件机制掩盖完整网络结果，反之亦然。

精确目标批准暂缓实现。未来策略可以为一次命令生命周期携带规范化的 host 与 port，但必须对完整后代进程树强制执行，并与文件升权分开审计。在此之前，所有由 agent 控制的命令都只有拒绝模式：批准 `danger-full-access` 绝不会启用网络。

## 已考虑的替代方案

**把 `danger-full-access` 当作无限制网络批准。** 拒绝，因为文件模式不说明目标、时长或网络用途。耦合两种权限会使一次写入批准静默授权网络外发。

**依赖代理环境变量。** 拒绝，因为不可信命令可以忽略或删除这些变量、使用其他协议、调用原始套接字，或以不同环境启动后代。强制执行必须位于进程下层。

**从 `PATH` 移除具备网络能力的命令。** 拒绝，因为 runtime 与包管理器可直接打开套接字，复制的二进制可以绕过名单，后代继承的是可执行文件访问而非可信 allowlist。

**把不支持的网络限制报告为 partial 后继续运行。** 拒绝，因为 partial 报告不会阻止流量。当策略承诺无连接时，不支持的后端必须阻止命令启动。

**让获批重试在一个进程生命周期内使用无限制网络。** 拒绝，因为仅限制时间并不能约束数据发送目标。在 runner 能强制执行命名目标之前，批准阶段仍不完整。

## 后果

- 解析后的策略默认拒绝子进程网络，且独立于每个 `SandboxMode` 值。
- Linux 与 macOS profile 拒绝命令及后代的远程与 loopback Internet 协议连接，同时保留本地 runtime 所需的 Unix 域 IPC。
- 后端分别报告网络强制执行，并在无法提供时于执行前失败。
- Shell 与 terminal 消费方在后端报告部分网络强制执行时拒绝 spawn。
- Windows shell 与 terminal 执行不可用，直到其后端能够完整强制执行所选网络策略。

## 测试

单元测试与真实 runner 测试覆盖直接与后代拒绝、远程与 loopback 目标、保留 Unix 域 IPC、`danger-full-access` 下文件不受限、部分后端在 spawn 前被拒绝，以及 runner 失败。

## 暂缓工作

- 为一个规范化目标加入一次性批准；审计记录需命名 host 与 port，后端需对完整进程树强制执行。
- 加入可报告 `networkEnforcement: 'full'` 的 Windows 机制；在此之前，该后端上的沙箱 shell 与 terminal 执行会失败闭合。

## 风险

安全默认值会使隐式下载依赖、联系许可证或包服务以及使用本地 TCP server 的命令失败。在精确目标批准落地后，本地开发工作流需要显式批准目标。Seccomp 必须覆盖替代套接字创建路径而不阻断 Unix 域 IPC；缺少完整机制的平台会拒绝执行，而不会扩大访问。
