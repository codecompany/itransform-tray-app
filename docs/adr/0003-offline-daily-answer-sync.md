# ADR-0003: Offline-first daily answer synchronization

**Status:** Accepted
**Date:** 2026-07-24
**Deciders:** iTransform team

## Context

iTransform Pulse may reach the daily question while the Pulse API is unavailable.
Employees can also answer the same question through Slack or email. Waiting for
the server before confirming a desktop answer makes an outage visible in the
core experience, while blind retries can overwrite an answer from another
channel.

## Decision

- The Electron main process owns the daily policy and encrypted persistent
  state. The renderer never receives credentials or direct storage access.
- An interactive first login checks immediately. A hidden login before 09:00
  waits until 09:00 local time; later logins check immediately.
- Skipping is an explicit snooze. Successive skips use bounded delays of 60,
  120, 180, and 240 minutes with jitter.
- Selecting an answer writes an encrypted outbox entry through an atomic file
  replacement before the UI confirms it.
- Every synchronization attempt calls the official question endpoint first.
  If `answered` is true, the local item is resolved as an external answer and
  is not submitted.
- If the question remains unanswered, iTransform Pulse submits the queued value.
  The server atomically preserves the first answer. HTTP `409` is also treated
  defensively as an external winner for compatibility with older deployments.
  Other failures keep the outbox item and schedule bounded exponential backoff
  with jitter.
- The server remains authoritative. Local state optimizes availability and
  never bypasses the server-side first-answer constraint.

## Options Considered

| Option | Outage experience | Cross-channel safety | Complexity |
|---|---:|---:|---:|
| Local outbox plus server preflight | Good | High | Medium |
| Submit synchronously from the UI | Poor | Medium | Low |
| Retry POST without preflight | Good | Low | Low |

## Consequences

- A Pulse API outage no longer blocks the local confirmation.
- A device restart does not lose a queued answer or snooze decision.
- A short interval exists where the UI reports a locally saved answer before
  the server confirms it; the status is shown as pending synchronization.
- Correctness depends on the Pulse API exposing `answered` and rejecting a
  second daily answer atomically.

## Rollback

Disable local enqueueing and return to synchronous submission in the IPC
handler. Existing encrypted outbox entries can remain on disk and will be
ignored by the older runtime; no server data migration is required.
