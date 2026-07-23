# Threat model — npm publishing credential bootstrap

## Scope and assets

This model covers the local helper that publishes the first public PulseTray
package version, creates one granular npm token, and stores it as the
repository's `NPM_TOKEN` Actions secret. The assets are the unpublished package
version, npm account password, emailed OTPs, reusable npm token, and GitHub
repository publishing permission. It does not cover Electron runtime secrets.

## Trust boundaries

The flow crosses the operator terminal to npm CLI, npm CLI to the public npm
registry, and the local shell to GitHub Secrets through `gh`. An attacker with
the operator's user account can inspect local processes; a repository reader
cannot read Actions secret values.

## STRIDE review

| Threat | Mitigation |
|---|---|
| Spoofing the npm or GitHub destination | Both CLIs use their configured HTTPS registries and authenticated accounts. |
| Tampering with mixed npm output | The script extracts and validates a complete JSON token before invoking `gh`. |
| Repudiation of secret changes | GitHub records the secret update timestamp; npm records the named token. |
| Disclosure through terminal or files | Silent prompts, no temporary credential file, no credential log, token transfer through standard input, and publish authentication through a process-scoped environment variable. |
| Denial of service through malformed output | Parsing fails before `gh`; mocks cover malformed and rejected responses. |
| Elevation through an over-broad token | The bootstrap token is limited to the `@code-company` scope, has a one-day expiry, and is revoked immediately after first publish; the retained token is limited to `@code-company/pulsetray`, read-write package permission, and 90 days. |
| Publishing under the wrong identity | The helper requires an organization role plus membership in `code-company:developers` before any credential or registry write and fails closed after an unsuccessful account switch. |
| Publishing a package without matching binaries | The script requires the same-version public GitHub Release and `SHA256SUMS.txt` asset before first publication. |
| Reusing an immutable bad version | The script publishes only the version declared in `npm-package/package.json`; correction requires a higher version. |
| Orphaning a bootstrap token after local failure | The helper selects same-name bootstrap tokens from JSON, correlates them with npm's unique shortened revocation IDs, fails closed on incomplete or ambiguous correlation, revokes them before every creation, and attempts immediate revocation when token parsing fails. |

## Residual risk and response

The npm child process receives credentials in its short-lived environment.
If immediate bootstrap-token revocation fails, the scope token remains active
for at most one day and the script names it explicitly for manual revocation.
The first published version is irreversible. The repository owner revokes
`pulsetray-bootstrap` and `pulsetray-github-actions`, deletes `NPM_TOKEN`, and
deprecates a faulty package version immediately if compromise or package
corruption is suspected.
