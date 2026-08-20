/**
 * Real-backend end-to-end coverage for Windows: the ACL provider cannot enforce
 * the independent child-network policy, so the PowerShell consumer must fail
 * before handing any argv to the subprocess service in every file mode.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SandboxPwshExecutor } from '../src/index.ts'

const isWin32 = process.platform === 'win32'

function pwshAvailable(): boolean {
  return spawnSync(resolvePwshPath(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$true'], { encoding: 'utf8' }).status === 0
}

describe.skipIf(!isWin32 || !pwshAvailable())('pwsh-sandbox real ACL confinement', () => {
  let workspaceRoot!: string
  let ctx!: Context
  let executor!: SandboxPwshExecutor

  beforeAll(async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-pwsh-sandbox-e2e-'))
    ctx = new Context()
    await ctx.plugin(LocalSandboxProvider, {})
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SandboxPwshExecutor, {})
    executor = ctx.shell as SandboxPwshExecutor
  })

  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it.each<SandboxMode>(['read-only', 'workspace-write', 'danger-full-access'])(
    '%s fails closed before spawn because the ACL backend has partial network enforcement',
    async (mode) => {
      const spawn = vi.spyOn(ctx.subprocess, 'spawn')
      const policy: SandboxExecutionPolicy = { mode, networkMode: 'deny-all', workspaceRoot }

      await expect(executor.run(executor.resolve({ command: 'echo never', sandboxPolicy: policy })))
        .rejects.toThrow(SandboxUnavailableError)
      expect(spawn).not.toHaveBeenCalled()
      spawn.mockRestore()
    },
  )
})
