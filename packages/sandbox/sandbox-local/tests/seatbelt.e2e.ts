import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import { seatbeltProfileArgs } from '../src/profiles.ts'

/**
 * Keyless backend integration through `confine()` and a real macOS Seatbelt process, with Linux
 * rungs forced off. Tests assert world effects and that the kernel denial matches the advertised
 * dialect; consumer coverage lives in dsh-bash-sandbox. Skips off macOS or when the profile probe
 * fails. HOME-based workspaces avoid Seatbelt's wholesale temp-directory grants, so
 * workspace-write proves the workspace-root grant itself.
 */

const probe = spawnSync('sandbox-exec', [...seatbeltProfileArgs({ mode: 'read-only', networkMode: 'deny-all', workspaceRoot: '/' }), '--', 'true'], { timeout: 5_000, stdio: 'ignore' })
const seatbeltUsable = probe.status === 0

let ctx: Context | undefined
const tempDirs: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(base: string): Promise<string> {
  const dir = await mkdtemp(join(base, 'dsh-seatbelt-e2e-'))
  tempDirs.push(dir)
  return dir
}

async function provider(): Promise<LocalSandboxProvider> {
  ctx = new Context()
  await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  sandbox.internals = { probeBwrap: () => false, probeLandlock: () => 'unusable' }
  return sandbox
}

/** Confine a shell command under `policy` and run it for real; returns the spawn result and the wrap's facts. */
function runConfined(sandbox: LocalSandboxProvider, command: string, policy: SandboxPolicy) {
  const confined = sandbox.confine(['bash', '-c', command], policy)
  const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 30_000, encoding: 'utf8' })
  return { result, confined }
}

function connectArgv(host: string, port: number): string[] {
  return [process.execPath, '-e', `const socket = require('node:net').connect(${port}, ${JSON.stringify(host)}); socket.on('connect', () => process.exit(0)); socket.on('error', () => process.exit(17)); setTimeout(() => process.exit(18), 1000)`]
}

function descendantConnectArgv(host: string, port: number): string[] {
  const child = connectArgv(host, port)
  return [process.execPath, '-e', `const { spawnSync } = require('node:child_process'); const result = spawnSync(${JSON.stringify(child[0])}, ${JSON.stringify(child.slice(1))}, { stdio: 'inherit' }); process.exit(result.status ?? 19)`]
}

describe.skipIf(!seatbeltUsable)('sandbox-local: real Seatbelt confinement through sandbox-exec', () => {
  it('denies direct and descendant IP connections, including loopback and a reserved remote address', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const policy = { mode: 'danger-full-access', networkMode: 'deny-all', workspaceRoot: workdir } as const
    const server = createServer(socket => socket.destroy())
    const socketPath = join(workdir, 'local-ipc.sock')
    const ipcServer = createServer(socket => socket.destroy())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    await new Promise<void>((resolve, reject) => {
      ipcServer.once('error', reject)
      ipcServer.listen(socketPath, resolve)
    })
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('expected a TCP listener')
      for (const argv of [
        connectArgv('127.0.0.1', address.port),
        descendantConnectArgv('127.0.0.1', address.port),
        connectArgv('198.51.100.1', 443),
      ]) {
        const confined = sandbox.confine(argv, policy)
        const result = spawnSync(confined.argv[0] as string, confined.argv.slice(1), { timeout: 5_000 })
        expect(result.status).toBe(17)
        expect(confined.networkEnforcement).toBe('full')
      }
      const ipcArgv = [process.execPath, '-e', `const socket = require('node:net').connect(${JSON.stringify(socketPath)}); socket.on('connect', () => process.exit(0)); socket.on('error', () => process.exit(17)); setTimeout(() => process.exit(18), 1000)`]
      const ipc = sandbox.confine(ipcArgv, policy)
      expect(spawnSync(ipc.argv[0] as string, ipc.argv.slice(1), { timeout: 5_000 }).status).toBe(0)
    } finally {
      await Promise.all([
        new Promise<void>(resolve => server.close(() => { resolve() })),
        new Promise<void>(resolve => ipcServer.close(() => { resolve() })),
      ])
    }
  })

  it('read-only denies a write — the file must NOT exist, and the kernel speaks the advertised dialect', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result, confined } = runConfined(sandbox, `echo hi > ${workdir}/denied.txt`, { mode: 'read-only', networkMode: 'deny-all', workspaceRoot: workdir })
    expect(result.status).not.toBe(0)
    expect(confined.enforcement).toBe('full')
    // The wrap's denialSignatures must be what the kernel actually prints.
    expect(result.stderr.toLowerCase()).toContain('operation not permitted')
    expect(existsSync(join(workdir, 'denied.txt'))).toBe(false)
  })

  it('read-only keeps the tree readable/executable and /dev/null writable', async () => {
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(sandbox, 'ls / > /dev/null && echo dev-ok', { mode: 'read-only', networkMode: 'deny-all', workspaceRoot: workdir })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('dev-ok\n')
  })

  it('read-only grants no temp area: a write under the user temp dir is denied too', async () => {
    // The per-user darwin temp dir is a workspace-write grant, not a
    // read-only one — under read-only the only write-shaped path is /dev/null.
    const workdir = await tempDir(tmpdir())
    const sandbox = await provider()
    const target = join(workdir, 'tmp-denied.txt')
    const { result } = runConfined(sandbox, `echo hi > ${target}`, { mode: 'read-only', networkMode: 'deny-all', workspaceRoot: await tempDir(homedir()) })
    expect(result.status).not.toBe(0)
    expect(existsSync(target)).toBe(false)
  })

  it('workspace-write lands a write inside the workspace root and still denies one beside it', async () => {
    const workdir = await tempDir(homedir())
    const outside = await tempDir(homedir())
    const sandbox = await provider()

    const inside = runConfined(sandbox, `printf seatbelt-ok > ${workdir}/allowed.txt`, { mode: 'workspace-write', networkMode: 'deny-all', workspaceRoot: workdir })
    expect(inside.result.status).toBe(0)
    expect(readFileSync(join(workdir, 'allowed.txt'), 'utf8')).toBe('seatbelt-ok')

    const denied = runConfined(sandbox, `echo hi > ${outside}/denied.txt`, { mode: 'workspace-write', networkMode: 'deny-all', workspaceRoot: workdir })
    expect(denied.result.status).not.toBe(0)
    expect(existsSync(join(outside, 'denied.txt'))).toBe(false)
  })

  it('workspace-write grants /tmp and the user temp dir (the documented Seatbelt-profile temp areas)', async () => {
    const workdir = await tempDir(homedir())
    const hostTmp = await tempDir('/tmp')
    const userTmp = await tempDir(tmpdir())
    const sandbox = await provider()
    const { result } = runConfined(
      sandbox,
      `printf tmp-ok > ${hostTmp}/scratch.txt && printf user-tmp-ok > ${userTmp}/scratch.txt`,
      { mode: 'workspace-write', networkMode: 'deny-all', workspaceRoot: workdir },
    )
    expect(result.status).toBe(0)
    expect(readFileSync(join(hostTmp, 'scratch.txt'), 'utf8')).toBe('tmp-ok')
    expect(readFileSync(join(userTmp, 'scratch.txt'), 'utf8')).toBe('user-tmp-ok')
  })
})
