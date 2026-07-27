# PulseTray npm auto-update runbook

## Symptom

PulseTray logs `npm_auto_update_failed`, remains on an older version, or does
not relaunch after preparing an update.

## Triage

1. Run `pulsetray --version` and record the installed version.
2. Run `npm view @code-company/pulsetray@latest version` and record the target.
3. Inspect `pulse-update.log` and `pulse-update-state.json` under the Electron
   user-data directory; do not copy tokens or personal data into an issue.
4. Inspect the npm prefix with `npm prefix --global` and confirm that
   `@code-company/pulsetray` exists below its global `node_modules` directory.
5. Check free disk space before retrying because staging temporarily requires
   space for a second portable payload.

## Mitigation

1. Reinstall the exact stable release through the supported channel:
   `npm install --global @code-company/pulsetray@<version>`.
2. Starts the validated installation: `pulsetray --hidden`.
3. Confirms the recovery: `pulsetray --version`.

## Rollback

Install the previous known-good package with
`npm install --global @code-company/pulsetray@<previous-version>`, then run
`pulsetray --version`. If the active package directory is absent and a
`.pulsetray-backup-*` directory exists beside it, stop PulseTray, rename the
newest backup to `pulsetray`, and rerun the exact-version install.

## Post-incident

Record the update ID, installed version, target version, operating system,
failure stage, and redacted log lines in the release issue. Never attach the
full process environment or npm credentials.
