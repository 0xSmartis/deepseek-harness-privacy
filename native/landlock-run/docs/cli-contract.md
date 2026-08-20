# CLI contract: landlock-run

This file pins the launcher's externally observable behavior — the cross-repo compatibility surface between the binaries and every consumer. Consumers interact with it through the entry package (`launcherPath`/`probe`/`grantArgs`) and the launcher protocol; changing anything below requires a version bump for the whole package family and a note in the release notes.

## Invocation grammar

```text
landlock-run [--ro <path>]... [--rw <path>]... [--deny-network] -- <argv>...
landlock-run --probe
```

- `--ro <path>`: grant read + execute beneath `<path>`.
- `--rw <path>`: grant full filesystem access beneath `<path>` (every access the negotiated kernel ABI can govern).
- `--deny-network`: reject IP socket creation and `io_uring_setup` while preserving Unix-domain sockets. The seccomp filter is independent of the filesystem grants.
- Everything not granted is denied — Landlock rulesets are allow-lists.
- A grant on a non-directory keeps only its file-compatible access bits (this is how a `--rw /dev/null` grant works).
- `--`: mandatory separator; everything after it is the command argv, exec'd via `execvp` with the launcher's environment unchanged.
- `--probe`: mutually exclusive with grants and a command.
- No other flags, no environment-variable inputs.

## Exit codes

- `125` (`LAUNCHER_FAILURE_EXIT`): every launcher-level failure — usage error, kernel that cannot enforce Landlock, unopenable grant root, failed `exec`. The wrapped command was NOT run.
- After a successful `exec`, every child status is passed through unchanged, including 125. Consumers therefore require both status 125 and a `landlock-run: ` fatal line to attribute launcher failure.
- `--probe`: `0` when the kernel enforces (fully or partially), `125` otherwise.

## Report lines

- Probe success prints exactly one stdout line: `landlock: fully enforced` or `landlock: partially enforced (older ABI)`. The entry package's `probe()` maps these to `full`/`partial`; a non-zero probe exit maps to `unusable`.
- A confined run under a partial-ABI kernel prints one stderr line `landlock-run: partial enforcement (older Landlock ABI)` and proceeds — still confined for everything the kernel supports.
- Every fatal error prints one stderr line prefixed `landlock-run: ` before exiting `125`.

## Confinement semantics

The launcher sets `no_new_privs`, installs the selected restrictions on itself, and `exec`s the command. Landlock filesystem rules and the optional seccomp network filter are inherited across `fork`, `clone`, and `execve`, so every descendant process is equally confined. The filesystem ruleset governs accesses in the kernel's negotiated Landlock ABI (up to ABI 5); accesses newer than the running ABI are not governed and are the difference between `full` and `partial`. Network denial supports Linux x64 and arm64, rejects every socket family except `AF_UNIX`, and rejects `io_uring_setup` so asynchronous socket operations cannot bypass the filter.
