# dsh-fs-sandbox：强制沙箱的文件系统后端

[English](README.md) | 中文

`SandboxedFileSystem` 扩展 [`LocalFileSystem`](../fs-local/README.md) 并注册为 `ctx.fs`。它继承本地存储机制，并为元数据、内容、列出、写入与编辑操作增加按调用的文件策略围栏。`resolve` 仍只负责身份映射。基于目标的操作会在检查包含关系前重新规范化所得目标；`lstat` 会规范化父目录，同时保留其不跟随最终路径组件的语义。

它原样复用本地后端配置：`cwd` 仍是相对路径的解析默认值，`diffBasisMaxBytes` 则限制可选的覆写上下文 diff 基础。

加载它来替代 `dsh-fs-local`，并同时加载 [`ctx.sandboxPolicy`](../../sandbox/sandbox-policy/README.md)，即可替换提供方。面向模型的消费方会把调用会话的模式和 cwd 解析为与 shell 家族相同的按调用策略。

## 围栏

按调用策略携带有效模式（会话覆盖值或升级授权）和调用会话不可变的 cwd 根目录；只有没有会话的调用才回退到部署策略：

- `read-only`：允许读取工作区与平台临时根目录，并以结构化 `FS_SANDBOX_DENIED` 拒绝所有变更；
- `workspace-write`：允许读写工作区与平台临时根目录（`/tmp`、`os.tmpdir()`）。[`readableRoots`](../../sandbox/sandbox/src/roots.ts) 与 [`writableRoots`](../../sandbox/sandbox/src/roots.ts) 从同一策略派生这些规范化集合。规范拼写使用词法快速路径；基于身份的祖先回退可以识别 Windows 长名称和 8.3 名称等别名等价根目录，而不会把无关前缀视为包含关系。委托前会立即重新规范化目标，因此工具解析后被替换的祖先符号链接也会被发现；
- `danger-full-access`：不加围栏直接委托。

## 威胁模型：策略围栏，而非内核边界

围栏是在可信代码中检查模型控制的路径：操作本身属于 seam（`open`、`rename`），只有目标路径不可信。不可信代码的内核级隔离仍由 `ctx.shell` 负责（[`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md)）。委托前立即重新规范化会缩小包含关系检查与文件系统操作之间的剩余竞态；内核严密边界需要平台专属的 `openat2` 一类原语。

拒绝是结构化 `FsError`（`FS_SANDBOX_DENIED`，携带有效模式），不通过 stderr 文本推断（不同于 bash 的内核拒绝），因为进程内围栏准确知道自己拒绝了什么。面向模型的 `[sandbox: file access denied under <mode> mode]` 标记以及唯一一次获批的更宽权限重试位于工具层（`dsh-tool-fs`），与 bash 完全相同。见[跨能力族 fs 沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md)。

## 模型体验

### 文件系统策略与拒绝

#### 模型看到的内容

策略归属方会贡献与具体能力无关的 `sandbox:policy` 上下文。作为间接影响，`dsh-tool-fs` 会把本后端的 `FS_SANDBOX_DENIED` 拒绝渲染为 `[sandbox: file access denied under <mode> mode]` 标记和同轮次升级提示。

#### Token 影响

该后端挂载期间，当前策略条款会增加一条简短的运行时上下文消息；拒绝则会把有界标记和升级提示追加到对话历史。

#### KV Cache 影响

常驻策略发生变化时，会在保留的历史之后追加一份由归属方渲染、取代先前状态的运行时上下文快照；操作结果保持仅追加。

## 已知限制与暂缓事项

- **策略围栏，而非内核边界**：该检查由可信代码处理模型控制的路径，因此原位重新规范化会缩小但不会消除解析到操作之间的竞态；对抗性宿主进程不在范围内。
- **进程读取仍是独立问题**：本提供方约束可信的 `ctx.fs` 操作；shell 命令仍需要 OS 后端提供读取约束。
- **临时根目录覆盖整个平台区域**：受限调用可以读取宿主临时区域，并在 `workspace-write` 下写入。每会话私有临时根目录仍是独立工作。
- **要求 `ctx.sandboxPolicy`**：工具使用它解析每个会话策略，后端用它处理无 agent（智能体）调用的回退；未组合该服务时，后端不会实施约束。
