# Automatic npm updates

## Scope

This model covers the Electron main process, the installed npm launcher, the
npm registry request, the GitHub release download, and the local package swap.
It does not change Pulse API authentication, user authorization, or renderer
network access.

## Assets and adversary

The protected assets are the executable package, the user's npm prefix, the
current working installation, and locally stored Pulse data. An attacker may
control registry or release responses, alter an updater argument, replace a
runtime manifest that the current user can write, interrupt the network, or
exhaust disk space. A publisher-account compromise remains inside the npm
distribution trust boundary required by this feature.

## Trust boundaries

The Electron process crosses into a child Node process, the helper crosses
from the local machine to the npm registry, npm lifecycle code crosses to the
GitHub release service, and the helper replaces one directory inside the
configured global prefix. Each boundary runs with the current user's
permissions; the updater never requests elevation.

## STRIDE review

| Threat | Control |
| --- | --- |
| Spoofing | The helper accepts only `@code-company/pulsetray`, reads `latest` through the configured npm CLI, and installs an exact stable version. |
| Tampering | npm validates package integrity; the existing postinstall verifies the release payload against `SHA256SUMS.txt`; the helper stages before replacing the active package and restores its backup if the swap fails. |
| Repudiation | Every run carries a random update ID through structured events and a bounded local result record. |
| Information disclosure | Child arguments and logs exclude tokens, employee data, form content, registry credentials, and the inherited environment. |
| Denial of service | Checks have timeouts, one run may exist at a time, failed checks back off for 24 hours, and stale staging directories are removed before use. |
| Elevation of privilege | The helper invokes Node and npm with literal argument arrays, rejects non-absolute runtime paths, confines package replacement to the manifest's validated package root, and never invokes a shell. |

## Residual risk and rollback

An attacker who controls the npm publisher account can publish lifecycle code
that executes with the installing user's permissions. npm provenance, account
controls, the exact package name, and the independent GitHub payload checksum
reduce but do not eliminate that distribution-authority risk. The PulseTray
team will revoke the affected npm version, repoint `latest`, publish a clean
patch, and direct users to the exact clean version if that boundary fails.

Power loss during the final two renames can leave the backup beside the active
directory. The runbook restores the backup when the active package is absent
or invalid. Until the helper commits the swap, the current executable remains
unchanged.
