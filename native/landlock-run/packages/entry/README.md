# @deepseek-ai/node-addon-landlock-run

English | [中文](README.zh.md)

Landlock and seccomp self-restrict-then-exec launcher for confining subprocesses on Linux: this entry package resolves the per-platform prebuilt binary, runs its functional enforcement probe, and builds its policy argv — consumers never spell launcher flags or parse launcher output themselves.

```js
import { grantArgs, launcherPath, probe } from '@deepseek-ai/node-addon-landlock-run';

const launcher = launcherPath();
if (probe(launcher) !== 'unusable') {
  const argv = [launcher, ...grantArgs({ readOnly: ['/'], readWrite: ['/tmp/work'], denyNetwork: true }), '--', 'bash', '-c', command];
}
```

The launcher installs a Landlock filesystem ruleset and, when requested, a seccomp filter that denies IP sockets while preserving Unix-domain IPC, then `exec`s the wrapped command. Both restrictions are inherited by the whole process tree. Filesystem access outside the grants is denied, and launcher failures exit `125` without running the command — fail-closed, never fail-open. The binary contract is pinned in the repo's `docs/cli-contract.md`; the C source rides this tarball (`src/main.c`) for audit.

Platform packages (`os`/`cpu`-selected optional dependencies, no JavaScript inside): `@deepseek-ai/node-addon-landlock-run-linux-x64`, `@deepseek-ai/node-addon-landlock-run-linux-arm64`. On hosts without one, `launcherPath()` returns a deterministic nonexistent path and `probe()` reports `'unusable'` — there is deliberately no install-time compile fallback.
