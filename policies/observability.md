# Observability

Default level is `info` — messages at `info` and above reach the user's console. Keep that surface lean (Obsidian guideline: avoid unnecessary logging to console).

- `error` / `fatal` — failures that lose data or need user action.
- `warning` — degraded state, recoverable.
- `info` — session-level milestones only: service start/stop, sync complete, config applied. One line per lifecycle event, not per item.
- `debug` — state transitions and decision branches (backfill done, watcher opened, conversion finished).
- `trace` — per-event / high-frequency paths (each watcher event, debounce reset).

Ship permanent `debug` / `trace` at decision points so a diagnosis reads the log instead of re-instrumenting. Structured fields answer what happened and which branch ran; on a hot path, gate a `trace` or `debug` record with `logLevelEnabled` so its context is built only when the level is on (see [logging](logging.md)).
