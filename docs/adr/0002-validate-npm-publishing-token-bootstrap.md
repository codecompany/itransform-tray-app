# ADR-0002 — Validate npm publishing credentials before GitHub storage

## Status

Accepted (2026-07-23 UTC).

## Decision request

Code Company accepts a local bootstrap for the first public PulseTray package
and its publishing credential on 2026-07-23 UTC. The script targets one
published package version and one successful GitHub secret write, from zero
published versions and zero valid secret writes in the failed attempts recorded
in the task shell output. The PulseTray repository owner executes it.

## Context

The npm CLI writes its password prompt before its JSON response. The first
script piped that mixed stream directly to a JSON parser and then to `gh`.
When parsing failed, the last pipeline process still created an empty
`NPM_TOKEN` secret. A second attempt showed that npm accepted the emailed OTP,
then returned `E401` because `--scopes codecompany` grants organization
management access rather than package publishing access. A third attempt
returned `E403` before any OTP challenge because publishing now requires
account 2FA or a granular write token configured to bypass 2FA. A
package-specific token cannot target PulseTray until its first version exists.
Further registry inspection showed that `codecompany` is a user-owned npm
namespace rather than the intended organization. The correct npm organization
is `code-company`; `osvaldoandrade` is its owner and belongs to
`code-company:developers`.

The first correctly scoped token was created, but its JSON response included
nested `permissions` and `scopes` objects. Selecting text from the final
opening brace produced an invalid fragment and left the one-day bootstrap token
active without exposing its full value to the operator.

The publishing workflow requires a granular token with scope write permission
and temporary 2FA bypass. The helper must handle the interactive exchange
without writing the password, OTP, or token to a file, command argument, log,
or repository.

## Decision

The helper validates that the matching public GitHub Release and checksum asset
exist, then verifies that the authenticated npm user has an organization role
and belongs to `code-company:developers`. If either check fails, it opens npm's
web login and rechecks both before requesting a password, creating a token, or
publishing. It then creates a one-day granular bootstrap token restricted to
`@code-company` with 2FA bypass, passes it to the single publish process through
an environment-scoped npm registry setting, and revokes it immediately after
publication. Finally, it creates a 90-day granular token restricted to
`@code-company/pulsetray`, validates the final JSON token, and writes it to
GitHub through standard input. Every state-changing stage fails closed before
the next one starts. Before creating a bootstrap token, the helper revokes any
same-name token left by an interrupted attempt. Token extraction walks balanced
JSON objects and accepts only an object with a string `token` field.

## Reversibility

The repository owner can revert the helper commit immediately. A published npm
version cannot be deleted and reused; rollback therefore means deprecating that
version and publishing a corrected higher version. If a token was created, the
owner revokes it in npm and deletes the repository secret.

## Consequences

The helper prevents malformed npm output from reaching GitHub and gives the
operator distinct bootstrap, revocation, and final-token OTP prompts. A
same-user process inspector may observe a child process environment during
authentication or publication; the script limits that exposure to the npm
process lifetime, clears its shell variables, restricts the bootstrap token to
the Code Company scope, and limits it to a one-day maximum even if immediate
revocation fails. The web login changes the active local npm session; the
operator can restore the previous account with a later `npm login`.

## Alternatives considered

1. Continue streaming npm output directly into `gh`. Rejected because one
   parser failure already produced an empty secret.
2. Store the npm response in a temporary file. Rejected because the file would
   contain a reusable publishing token.
3. Create an organization-scoped token before the package exists. Rejected
   because npm organization access does not grant package publishing access.
4. Publish with the existing login token and an emailed OTP. Rejected because
   npm returns `E403` without offering an OTP challenge when account 2FA is not
   enabled.
5. Create a team under `codecompany`. Rejected because that is a user-owned
   namespace and not the intended `code-company` organization.
6. Publish under `@codecompany`. Rejected because the intended public package
   belongs under the verified `@code-company` organization scope.

## References

- `scripts/configure-npm-publish-token.sh`
- `docs/threat-models/0001-npm-publishing-credential-bootstrap.md`
- T-1, T-2, T-4 and T-7
