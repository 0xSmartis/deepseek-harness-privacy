/**
 * Internal platform-profile builders for the local sandbox provider.
 *
 * @module @deepseek-ai/dsh-sandbox-local/profiles
 */

import { grantArgs as landlockGrantArgs } from '@deepseek-ai/node-addon-landlock-run'
import { writableRoots } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

/**
 * Build the bwrap profile arguments for one file and network policy.
 * @param policy - complete execution policy to express as bwrap namespaces and mounts.
 * @returns profile arguments before the trailing separator and command argv.
 */
export function bwrapProfileArgs(policy: SandboxPolicy): string[] {
  const args = policy.mode === 'danger-full-access'
    ? ['--bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--die-with-parent']
    : ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent']
  args.push('--unshare-net')
  if (policy.mode === 'workspace-write') {
    args.push('--tmpfs', '/tmp')
    args.push('--bind', policy.workspaceRoot, policy.workspaceRoot)
  }
  return args
}

/**
 * Build the Landlock launcher grants for one file and network policy.
 * @param policy - complete execution policy to express as Landlock and seccomp rules.
 * @returns launcher grant arguments before the trailing separator and command argv.
 */
export function landlockProfileArgs(policy: SandboxPolicy): string[] {
  if (policy.mode === 'danger-full-access') {
    return landlockGrantArgs({ denyNetwork: true })
  }
  const readWrite = ['/dev/null']
  if (policy.mode === 'workspace-write') {
    readWrite.push('/tmp', policy.workspaceRoot)
  }
  return landlockGrantArgs({ readOnly: ['/'], readWrite, denyNetwork: true })
}

/** Quote one path as an SBPL string literal. */
function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Build the sandbox-exec arguments and SBPL profile for one policy. Network
 * operations are denied independently of file mode. The
 * writable roots come from the shared {@link writableRoots} helper (canonical,
 * deduplicated) so the Seatbelt grant and the in-process fs fence
 * (`@deepseek-ai/dsh-fs-sandbox`) can never drift apart.
 * @param policy - file-effect policy to express as an SBPL profile.
 * @returns sandbox-exec arguments before the trailing separator and command argv.
 */
export function seatbeltProfileArgs(policy: SandboxPolicy): string[] {
  const forms = [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound (remote ip))',
    '(deny network-bind (local ip))',
    '(deny network-inbound (local ip))',
  ]
  if (policy.mode !== 'danger-full-access') {
    forms.push('(deny file-write*)', `(allow file-write* (literal ${sbplString('/dev/null')}))`)
    const roots = writableRoots(policy)
    if (roots.length > 0) {
      forms.push(`(allow file-write* ${roots.map(root => `(subpath ${sbplString(root)})`).join(' ')})`)
    }
  }
  return ['-p', forms.join(' ')]
}
