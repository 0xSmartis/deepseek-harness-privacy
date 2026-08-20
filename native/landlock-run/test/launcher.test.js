/**
 * Behavioral tests against the REAL launcher binary on a real kernel: the
 * CLI contract (usage errors, exit codes, argv passthrough) and the
 * confinement world-proofs (denied writes stay off disk, grants land).
 *
 * Preconditions and their skip semantics:
 * - Non-Linux host: skips entirely (exit 0) — there is nothing to build here.
 * - Linux without the built binary: FAILS — run `pnpm build:native` first.
 * - Linux whose kernel does not enforce Landlock: skips the enforcement
 *   half, unless `NALR_REQUIRE_LANDLOCK=1` (set on CI, where a silent skip on
 *   the very platform that exists to prove enforcement would be a false
 *   green).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import {
  LAUNCHER_FAILURE_EXIT,
  grantArgs,
  launcherPath,
  probe,
} from '@deepseek-ai/node-addon-landlock-run';

const FATAL_PREFIX = 'landlock-run: ';
const PARTIAL_NOTICE = 'landlock-run: partial enforcement (older Landlock ABI)';
const requireLandlock = process.env.NALR_REQUIRE_LANDLOCK === '1';

if (process.platform !== 'linux') {
  console.log(`launcher.test: SKIP — the launcher only exists on linux (host: ${process.platform})`);
  process.exit(0);
}

const launcher = launcherPath();
assert.ok(
  fs.existsSync(launcher),
  `launcher.test: no built launcher at ${launcher} — run \`pnpm build:native\` (apt-get install musl-tools) first`,
);

const run = (args, options = {}) => spawnSync(launcher, args, { encoding: 'utf8', ...options });

// --- usage errors: parse failures exit LAUNCHER_FAILURE_EXIT before any restriction ---
{
  const noCommand = run([]);
  assert.equal(noCommand.status, LAUNCHER_FAILURE_EXIT);
  assert.ok(noCommand.stderr.startsWith(FATAL_PREFIX));
  assert.match(noCommand.stderr, /usage error: missing `-- <argv>\.\.\.` command/);

  const unknownFlag = run(['--bogus', '--', 'true']);
  assert.equal(unknownFlag.status, LAUNCHER_FAILURE_EXIT);
  assert.match(unknownFlag.stderr, /usage error: unknown argument: --bogus/);

  const danglingPath = run(['--ro']);
  assert.equal(danglingPath.status, LAUNCHER_FAILURE_EXIT);
  assert.match(danglingPath.stderr, /--ro requires a path/);

  for (const args of [
    ['--probe', '--ro', '/'],
    ['--probe', '--deny-network'],
    ['--probe', '--'],
    ['--probe', '--probe'],
  ]) {
    const probeWithExtras = run(args);
    assert.equal(probeWithExtras.status, LAUNCHER_FAILURE_EXIT);
    assert.match(probeWithExtras.stderr, /--probe takes no other arguments/);
  }
}

const connectArgv = (host, port) => [
  process.execPath,
  '-e',
  `const socket = require('node:net').connect(${port}, ${JSON.stringify(host)}); socket.on('connect', () => process.exit(0)); socket.on('error', () => process.exit(17)); setTimeout(() => process.exit(18), 1000)`,
];

const descendantConnectArgv = (host, port) => {
  const child = connectArgv(host, port);
  return [
    process.execPath,
    '-e',
    `const { spawnSync } = require('node:child_process'); const result = spawnSync(${JSON.stringify(child[0])}, ${JSON.stringify(child.slice(1))}, { stdio: 'inherit' }); process.exit(result.status ?? 19)`,
  ];
};

// --- probe: the functional availability signal ---
const enforcement = probe(launcher);
console.log(`launcher.test: probe → ${enforcement}`);
if (enforcement === 'unusable') {
  if (requireLandlock) {
    console.error('launcher.test: NALR_REQUIRE_LANDLOCK=1 but the probe reports unusable — this kernel cannot prove enforcement');
    process.exit(1);
  }
  console.log('launcher.test: SKIP enforcement half — kernel does not enforce Landlock');
  process.exit(0);
}

// --- network-only confinement: deny IP sockets across descendants while preserving files and Unix IPC ---
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-network-test-'));
  const marker = path.join(work, 'file-write.txt');
  const fileWrite = run([...grantArgs({ denyNetwork: true }), '--', process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`]);
  assert.equal(fileWrite.status, 0, fileWrite.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');

  const tcpServer = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    tcpServer.once('error', reject);
    tcpServer.listen(0, '127.0.0.1', resolve);
  });
  const socketPath = path.join(work, 'local-ipc.sock');
  const ipcServer = createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    ipcServer.once('error', reject);
    ipcServer.listen(socketPath, resolve);
  });
  try {
    const address = tcpServer.address();
    assert.ok(address !== null && typeof address !== 'string');
    for (const argv of [
      connectArgv('127.0.0.1', address.port),
      descendantConnectArgv('127.0.0.1', address.port),
      connectArgv('198.51.100.1', 443),
    ]) {
      const denied = run([...grantArgs({ denyNetwork: true }), '--', ...argv], { timeout: 5_000 });
      assert.equal(denied.status, 17, denied.stderr);
    }

    const unix = run([
      ...grantArgs({ denyNetwork: true }),
      '--',
      process.execPath,
      '-e',
      `const socket = require('node:net').connect(${JSON.stringify(socketPath)}); socket.on('connect', () => process.exit(0)); socket.on('error', () => process.exit(17)); setTimeout(() => process.exit(18), 1000)`,
    ]);
    assert.equal(unix.status, 0, unix.stderr);
  } finally {
    await Promise.all([
      new Promise(resolve => tcpServer.close(resolve)),
      new Promise(resolve => ipcServer.close(resolve)),
    ]);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
const expectedNotice = enforcement === 'partial' ? `${PARTIAL_NOTICE}\n` : '';
{
  const probeRun = run(['--probe']);
  assert.equal(probeRun.status, 0);
  assert.match(probeRun.stdout, /^landlock: (fully enforced|partially enforced \(older ABI\))\n$/);
}

// --- confined exec: the command runs, its exit code passes through ---
{
  const echo = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', 'echo confined-ok']);
  assert.equal(echo.status, 0, echo.stderr);
  assert.equal(echo.stdout, 'confined-ok\n');
  assert.equal(echo.stderr, expectedNotice);

  const exitCode = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', 'exit 7']);
  assert.equal(exitCode.status, 7, 'the wrapped command exit code must pass through unchanged');

  const child125 = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `exit ${LAUNCHER_FAILURE_EXIT}`]);
  assert.equal(child125.status, LAUNCHER_FAILURE_EXIT, 'a wrapped child may itself return the launcher failure status');
  assert.equal(child125.stderr, expectedNotice);
}

// --- world-proofs: denied writes stay off disk, grants land, inheritance crosses exec ---
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nalr-launcher-test-'));

  const denied = path.join(work, 'denied.txt');
  const deniedRun = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `echo x > ${denied}`]);
  assert.notEqual(deniedRun.status, 0, 'a write outside the grants must fail');
  assert.ok(!fs.existsSync(denied), 'the denied write must not land on disk');

  const granted = path.join(work, 'granted.txt');
  const grantedRun = run([...grantArgs({ readOnly: ['/'], readWrite: [work] }), '--', '/bin/sh', '-c', `echo ok > ${granted}`]);
  assert.equal(grantedRun.status, 0, grantedRun.stderr);
  assert.equal(fs.readFileSync(granted, 'utf8'), 'ok\n');

  // The ruleset is inherited across execve: a CHILD of the wrapped command
  // is confined too, not just the direct exec target.
  const nested = path.join(work, 'nested.txt');
  const nestedRun = run([...grantArgs({ readOnly: ['/'] }), '--', '/bin/sh', '-c', `/bin/sh -c 'echo x > ${nested}'; true`]);
  assert.equal(nestedRun.status, 0, nestedRun.stderr);
  assert.ok(!fs.existsSync(nested), 'a denied write from a nested child must not land either');

  fs.rmSync(work, { recursive: true, force: true });
}

// --- fail closed: an unopenable grant root refuses to exec at all ---
{
  const marker = path.join(os.tmpdir(), `nalr-should-not-exist-${process.pid}`);
  const badGrant = run(['--ro', '/no/such/grant/root', '--', '/bin/sh', '-c', `echo x > ${marker}`]);
  assert.equal(badGrant.status, LAUNCHER_FAILURE_EXIT);
  assert.ok(badGrant.stderr.startsWith(FATAL_PREFIX));
  assert.match(badGrant.stderr, /cannot open rule path/);
  assert.ok(!fs.existsSync(marker), 'the command must never run when the launcher fails');
}

console.log('launcher.test: ok');
