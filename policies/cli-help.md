# CLI help

Help text and reference live in code, generated from the same registries the handlers use.

## Node.js scripts

Use yargs for argument parsing. The epilogue carries the detailed reference, built from the same constants the handlers run — agents read `--help` for the full contract.

A script that agents run prints plain text. A pass prints one result line. A failure ends with the failed step and the path of its full log.

## Obsidian CLI

Expose a guide subcommand that renders reference sections from the handler's own constants and vocabularies — the Template Workbench `guide.ts` is the pattern.

Register each handler as an Effect through `CliHost.registerCliCommand` (`packages/obsidian-kit/src/cli-command.ts`), and fail with an `Error` whose message the caller can act on. The plugin runs it on its runtime, and `ZotLitPlugin.registerCliHandler` turns every failure into its message text, which Obsidian prints as `Error: <message>` (`packages/obsidian-kit/src/cli-rejection.ts`).

## Placement

CLI help text and reference live next to the implementation, in the same package, as hardcoded English. A help string built from exported constants stays current when the constants change.
