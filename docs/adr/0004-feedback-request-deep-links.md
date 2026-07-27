# ADR-0004 — Open feedback requests through PulseTray links

## Status

Accepted (2026-07-27 UTC).

## Decision request

The PulseTray team will ship the `pulsetray://feedback/send` URI in the next
desktop release. Feedback-request e-mails move from zero actionable app links
to one app link, verified by the desktop parser, renderer, and Pulse Service
e-mail tests, at the cost of maintaining one operating-system protocol
registration; the PulseTray team owns implementation and rollback.

## Context

The current e-mail identifies the colleague who requested feedback but asks the
recipient to find and open the desktop app manually. The feedback wizard then
asks the recipient to select that colleague again.

The link may arrive before Electron is ready, while another app instance is
running, or before the employee links the device. The URL must not carry a
display name or e-mail address because those values become visible to browsers,
mail clients, and operating-system launch history.

## Decision

PulseTray registers the `pulsetray` scheme and accepts only
`pulsetray://feedback/send?requester_id=<employee-id>`. The main process holds a
valid route until the panel can consume it. The renderer resolves the opaque ID
through the existing authenticated employee directory and preselects that
employee in the send-feedback wizard.

Pulse Service writes the requester ID into the deep link, keeps the escaped
requester name in the visible e-mail copy, and includes the release page as the
installation fallback.

## Reversibility

The PulseTray team can restore the static e-mail and remove the protocol
registration in one release. The change writes no data and changes no feedback
API contract.

## Consequences

The e-mail-to-wizard path removes one manual app-navigation step and one
recipient-selection step. URI parser and UI tests provide the reproducible
source for this behavior. Operating systems still decide whether a mail client
may launch a custom protocol; the release-page link remains available when no
handler exists.

## Alternatives considered

1. Put the requester name and e-mail in the URL. Rejected because mail clients
   and operating-system launch history would retain unnecessary personal data.
2. Add a public HTTP redirect endpoint. Rejected because it adds an unauthenticated
   network surface when the desktop protocol plus a visible install fallback
   satisfies the current flow.

## References

- T-1: customers over cleverness.
- T-7: public URI contracts are one-way doors.
- `docs/adr/0001-secure-electron-boundaries.md`.
