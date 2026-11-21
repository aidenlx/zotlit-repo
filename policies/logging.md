# Logging

Effect is the logging API of the Obsidian plugins: `Effect.logInfo` and its siblings, with fields through `Effect.annotateLogs` and timing through `Effect.withLogSpan`. Plain code runs the record on its bridge (`bridge.runSync`) or, with no runtime in reach, with `Effect.runSyncWith(logServices)` from `@zotlit/plugin-kernel/effect-log.ts`. On a hot path, gate a `trace` or `debug` record with `logLevelEnabled(level)` from the same module, so the record is built and run only when the bundle's level lets it through. `zotlit-logging/effect-logging-only` enforces this API (`packages/config/oxlint-plugin-logging.ts`); the plugin logger's console sink and the Worker's log port (`effect-log-port.ts`) are the only console writers. Categories: `[<plugin manifest id>, "<workspace>", ...]`, so ZotLit logs under `["zotlit", ...]` and ZotLit Reader under `["zotlit-reader", ...]`; see each package's `AGENTS.md` for how a log names its category.

Each plugin bundle has one Effect Logger, `pluginLogger` in `packages/plugin-kernel/src/effect-log.ts`, with a level and sinks of its own: the console (`devToolsFormatter`) and the `zotlit.log.jsonl` file (`Logger.batched` over the vault adapter). `layerLogging` sets them from the log settings; outside its life, error and fatal records go to the console. The category root is the bundle's manifest id, `__PLUGIN_ID__` at build time. `apps/zotero` is a separate host and keeps LogTape.

The ZoteroReads worker logs through Effect, and its records travel to the renderer over a port. The host re-emits them into the renderer's Effect logger, so the plugin's sinks and log level apply to them unchanged, and each record keeps the time the worker logged it (`LogTimestamp`).

An app-agnostic library without Effect in a file can call `logLibrary` from `@zotlit/shared/logging`. The sink is a module global of one JavaScript realm, and the realm's entry installs it: importing the renderer's `effect-log.ts` plugin logger (every Effect entry point does), or the ZoteroReads log port while that worker runs. A realm that runs a `logLibrary` caller (today the `@zotlit/db` readers of Zotero rows) installs a sink before it does; one that imports only `@zotlit/db` helpers that never log (the citation-parse worker, the Zotero plugin, `@zotlit/workbench` pages) needs none.

Only an app configures sinks: a library logs and leaves the sinks to the app that hosts it (in the Obsidian plugins, `layerLogging`).

Packages designed as a third-party contract instead accept a structured-logger port and default it to a no-op, so a consumer keeps its own logging stack. `@zotlit/obsidian-i18n` is the one such package today: its generated message runtime takes the logger through `setLogger`, and ZotLit passes one that writes through `Effect.log*` under `i18n`; see [ADR 0013](../docs/adr/0013-obsidian-i18n-is-one-package-behind-injected-ports.md).

A shared core whose host does its logging carries no logger of its own, and names every decision a host acts on in the value it returns instead — a Problem, a render diagnostic — so the host logs. `@zotlit/workbench` is the one such package today; see [its README](../packages/workbench/README.md).

Prefer structured logging (named fields object) over interpolated template strings. Build expensive context only on the branch that logs it, behind `logLevelEnabled`.
