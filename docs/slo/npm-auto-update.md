# PulseTray npm auto-update SLO

## Scope and measurement

This SLO covers npm-installed clients with a valid runtime manifest. The local
`pulse-update-state.json` file is the measurement source; PulseTray sends no
update telemetry or employee data to a central collector.

## Indicators

| Indicator | Target | Window |
| --- | --- | --- |
| Active-package preservation after a failed attempt | 100% of injected and observed failures | Each release and 28-day local rolling window |
| Stable update completion | At least 99% of prepared attempts | 28-day local rolling window |
| Check freshness while the process runs | At least one completed check per 6 hours, excluding retry backoff | 28-day local rolling window |
| Restart safety | 100% of prepared attempts defer while any blocker is present | Each release and 28-day local rolling window |

## Error budget and response

One active-package loss or one restart-safety violation consumes the complete
error budget and stops release promotion. Other failures may consume 1% of
prepared attempts over 28 days; the helper preserves the current app and waits
at least 24 hours before retrying. Operators use the correlated `update_id`,
bounded log, local counter file, and `docs/runbooks/npm-auto-update.md` for
triage.

## Central telemetry decision

This desktop client has no existing metrics or tracing backend. Adding one
would create a new privacy and network boundary unrelated to package updates.
Structured JSON events, bounded counters, and the update ID provide the three
required diagnostic roles locally: event detail, aggregate outcome, and
cross-process correlation.
