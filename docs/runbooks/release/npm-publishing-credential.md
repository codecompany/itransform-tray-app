# npm publishing credential

## Symptom

The release job reports `E403`, `EOTP`, or skips npm smoke jobs because
`NPM_TOKEN` is missing or cannot bypass the npm publishing 2FA policy.

## Triage

1. Run `npm whoami --registry=https://registry.npmjs.org`.
2. Run `gh secret list --repo codecompany/itransform-tray-app`.
3. Inspect only the failed `publish-npm` step; never print either credential.

## Mitigation

Run `scripts/configure-npm-publish-token.sh`. The helper verifies that the
active npm user has a role in `code-company` and belongs to its `developers`
team; it opens npm's web login only when either check fails. After access
confirmation, enter the password and subsequent OTPs to create the one-day
`@code-company` bootstrap token and revoke it after publishing the version
whose GitHub Release is already public. Enter the final emailed OTP to create
the package-specific token. Confirm that the script reports access
confirmation, bootstrap revocation, and `NPM_TOKEN` configuration, then rerun
only failed jobs for the existing release workflow.

The helper intentionally creates tokens without `--json`: npm 11 masks the
token value as `npm_***` in JSON output even though the registry has created
the credential. The helper accepts the one-time `Created token` line and never
prints or writes its value.

If a prior attempt created `pulsetray-bootstrap` but stopped before publishing,
rerun the helper. It locates the token by name, correlates the partial token
shown by npm with its unique shortened revocation ID, requests an OTP to revoke
it, and only then creates a replacement. Do not pass the masked JSON key `***`
to `npm token revoke`.

## Rollback

Delete the GitHub secret with
`gh secret delete NPM_TOKEN --repo codecompany/itransform-tray-app`. Revoke the
token named `pulsetray-github-actions` through `npm token list` and
`npm token revoke`. Also revoke `pulsetray-bootstrap` if it exists. A published
version cannot be reused; deprecate it and release a corrected higher version
when necessary.

## Post-incident

Record any credential disclosure under
`docs/incidents/YYYY-MM-DD-npm-publishing-credential.md` and rotate the token
before rerunning a release.
