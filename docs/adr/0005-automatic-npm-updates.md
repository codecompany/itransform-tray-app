# ADR-0005 — Update PulseTray automatically through npm

## Status

Accepted (2026-07-27 UTC).

## Decision request

The PulseTray team will ship automatic npm updates in desktop release 0.1.22
on 2026-07-27 UTC. An npm-installed client moves from zero automatic update
attempts to one check at startup and one check every six running hours, at the
cost of a controlled background npm process and one restart after a verified
update; the PulseTray team owns implementation and rollback.

## Context

The npm package installs a signed release payload and validates that payload
against `SHA256SUMS.txt`, but the installed desktop process never asks npm for
a later package. On 2026-07-27 UTC, `npm view
@code-company/pulsetray@latest version` returned 0.1.21 while the executable at
`/opt/homebrew/bin/pulsetray` reported 0.1.20. Those commands are the
reproducible baseline for this decision.

The desktop app starts the packaged executable directly at login, so changing
the command-line launcher alone would not update a long-running installation.
The updater must also avoid replacing a Windows executable while it is
running, interrupting a feedback submission, or discarding a form that the
renderer still holds in memory.

## Decision

The npm `postinstall` writes a versioned runtime manifest containing the
absolute package root, npm prefix, Node executable, npm CLI, and PulseTray
launcher. The desktop main process accepts that manifest only from the
expected package root and invokes the launcher with fixed internal arguments;
it never builds a shell command.

The launcher asks npm for the stable `latest` version, validates strict
`major.minor.patch` syntax, and stages that exact version under the same npm
prefix. The staged package must complete the existing GitHub release download
and SHA-256 validation before the desktop app agrees to restart. After the
parent process exits, the helper renames the active package to a backup,
renames the staged package into place, and relaunches PulseTray. A failed swap
restores the backup before relaunch.

The desktop app checks once after startup and every six running hours. It
defers preparation while a daily question is required, an API operation is in
flight, a window is visible, or a renderer reports an edited form. Failures
enter a retry backoff of at least 24 hours with up to one hour of jitter.
Structured JSON events, a correlation ID, and
bounded local counters record checks, available versions, successes, and
failures without names, e-mail addresses, tokens, or form content.

## Reversibility

The PulseTray team can disable automatic checks in one desktop release by
removing the coordinator call. The npm launcher and runtime manifest remain
compatible with manual `npm install --global
@code-company/pulsetray@<version>`. If release 0.1.22 fails before it can
self-update, reinstalling 0.1.21 restores the previous behavior.

## Consequences

Npm-installed clients can move to a later stable package without a manual
install command. The updater downloads the new package while the current
package remains active and narrows the unavailable interval to the package
directory rename and process restart.

The first automatic-capable release still needs one manual update because
0.1.20 and 0.1.21 contain no updater. The runtime does not add a telemetry
backend; local counters and correlated structured logs provide diagnostics
without expanding the product's privacy or network surface.

## Alternatives considered

1. Run `npm install` directly inside the Electron process. Rejected because a
   failed install could replace the active package before validation and
   Windows may lock the running executable.
2. Add `electron-updater`. Rejected because it adds a dependency and a second
   release channel when npm is the requested distribution authority.
3. Update only when a user runs `pulsetray`. Rejected because login launches
   the packaged executable directly and long-running tray processes would
   remain stale.

## References

- T-1: customers over cleverness.
- T-2: write the narrative first.
- T-5: boring choices by default.
- T-6: operational excellence is a feature.
- `docs/adr/0002-validate-npm-publishing-token-bootstrap.md`.
- `docs/threat-models/0003-automatic-npm-updates.md`.
