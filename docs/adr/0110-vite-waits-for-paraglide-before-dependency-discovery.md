---
status: accepted
---

# Vite waits for Paraglide before dependency discovery

Framework plugins can discover dependencies during Vite configuration.
Waiting until `buildStart` to generate imports lets the framework see missing
files on a fresh checkout.

`packages/paraglide-vite/src/index.ts` awaits Paraglide compilation in Vite's
configuration hook before Vite creates environments and scans dependencies.
Vite owns filesystem watching. The compiler and the incremental cache stay
local to the Vite plugin instance. To reuse files already on disk, the plugin
seeds hashes from each file's contents and absolute destination, which are
the inputs used by the compiler's writer.

A change can arrive while the compiler is writing. Queue rebuilds so they
finish in order and only one compiler writes to the output at a time. A dev
watch failure reports a warning so the next edit can retry compilation.

The integration test starts real Vite and delivers a fixture change after the
watch paths are registered. It checks startup generation and regeneration
through the same hooks as a consuming app.

[Paraglide's upstream bundler integration](https://github.com/opral/paraglide-js/blob/abeba5009e22761518964dcfc1ec8f49d4551f41/src/bundler-plugins/unplugin.ts)

Workbench sources read the generated plugin Message facade. Its Turbo
typecheck and test tasks depend on plugin Language Pack generation.

The End-to-end Run typecheck reads the generated Message facades
and Reader assets. Its cases load the generated Query Schema file
and bundle the generated assets in the Reader probe.

Plugin Services tasks that read the generated Message facade depend on
Language Pack generation.

Citations tasks that read the generated Message facade depend on
Language Pack generation.

Notes and Plugin Shell tasks that read the generated Message facade
depend on Language Pack generation.

Annotations and Query Views tasks that read the generated Message
facade depend on Language Pack generation.

Obsidian Kit tasks that read the generated Message facade depend on
Language Pack generation.

ZoteroReads, Library View and Plugin Kernel tasks that read the
generated Message facade depend on Language Pack generation. The
Plugin Kernel brand test also reads the canonical logo SVGs.

Obsidian Desktop tasks that read the generated Message facade depend
on Language Pack generation.
