# npm auto-update rollout

## Owner and scope

The PulseTray team owns the rollout for npm-installed macOS and Windows
clients. Standalone DMG, NSIS, and portable installations have no npm runtime
manifest and keep their current update behavior.

## Ladder

1. The test stage installs a package against a local release server, validates
   its checksum, exercises npm-current, npm-offline, blocked-restart,
   post-stage corruption, and rollback paths, and requires 90% statement and
   branch coverage on the updater packages.
2. The local canary installs 0.1.22 from npm on one macOS arm64 device, verifies
   the launcher, runtime manifest, hidden launch, and `current` update result,
   then holds the tray process for 30 minutes.
3. The release pipeline publishes 0.1.22 after both platform builds and npm
   smoke jobs pass. Existing 0.1.20 and 0.1.21 clients require this final
   manual bootstrap because they contain no updater.
4. Starting with the next stable package, eligible clients check after startup
   and every six running hours. At least 24 hours plus up to one hour of jitter
   separates failures, so npm does not receive a synchronized retry wave.

Npm does not expose a percentage rollout control for installed clients. The
package version and runtime manifest form the activation boundary: standalone
builds never enter the path, and installing an exact previous package removes
the path from an affected device.

## Success and kill criteria

Success requires all automated tests and release jobs green, the local canary
remaining launchable for 30 minutes, and `pulse-update-state.json` recording
no failure during that window. Stop the rollout on any case where a failed
update removes the active package, PulseTray restarts with a reported form
blocker, or the published npm and GitHub release versions differ.

## Rollback drill

The failure-injection suite deletes the staged launcher after preparation and
asserts that the helper restores the prior payload before relaunch. Before
publishing, the local canary will install 0.1.21, reinstall 0.1.22, and record
the observed recovery time. Production mitigation uses the exact-version
command in `docs/runbooks/npm-auto-update.md`; a follow-up patch disables the
coordinator if the package itself is faulty.
