# Feedback-request deep links

## Scope

This model covers `pulsetray://feedback/send` input received by the Electron
main process and the requester ID forwarded to the sandboxed renderer. It does
not change Pulse API authentication or feedback authorization.

## Assets and adversary

An attacker who can place a link in a message may try to open an unintended app
surface, inject display data, or select an employee outside the signed-in
employee's company. The protected assets are Electron navigation integrity and
the authenticated employee directory.

## STRIDE review

| Threat | Control |
| --- | --- |
| Spoofing | The link carries only an employee ID; the authenticated directory supplies the employee record. |
| Tampering | The parser accepts one scheme, host, path, parameter, and bounded ID grammar. |
| Repudiation | The link triggers navigation only; the existing feedback submission path retains its idempotency and service telemetry. |
| Information disclosure | The URL excludes requester name, e-mail, company, and tokens. |
| Denial of service | The parser rejects inputs above 2,048 characters and stores one pending route. |
| Elevation of privilege | The renderer cannot bypass the existing employee list or backend target validation. |

## Residual risk and rollback

Mail clients and operating systems may decline custom-protocol launches. The
e-mail exposes the release page as a fallback. The PulseTray team can remove the
scheme and restore the static e-mail in one release without data recovery.
