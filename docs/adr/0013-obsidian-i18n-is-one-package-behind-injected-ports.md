---
status: amended ([#1710](https://github.com/aidenlx/zotlit/issues/1710))
---

# Obsidian i18n is one package behind injected ports

> **Amended ([#1710](https://github.com/aidenlx/zotlit/issues/1710)).** The Language Pack Lifecycle moved out of the package
> into each host. The package keeps the compiler, schema, validation,
> interpreter, CLI, Vite integration, and the lifecycle's vocabulary: locale
> resolution (`resolveLocale`), the Situation union, and the Pack Source and
> Locale Catalog types. ZotLit runs the lifecycle (consent, device cache,
> download) as its `LanguagePack` Effect service, with storage, language, and
> HTTP read from the plugin's own capabilities, so the lifecycle's ports and
> ZotLit's port adapter are gone. A host's lifecycle is short and follows its
> own runtime and UI; the security-sensitive part, pack validation, stays in
> the package. The `StructuredLogger` port remains on the generated message
> runtime (`setLogger`).

The JSON Language Pack compiler, schema, validation, interpreter, headless
Obsidian lifecycle, CLI, and Vite integration live together in
`@zotlit/obsidian-i18n`. The compiler emits an isolated runtime for each
consumer project, while the lifecycle accepts language, device-storage, HTTP,
and logging ports; consuming plugins retain their pack locations, release
policy, and rendered UI. This keeps the security-sensitive pack contract
versioned as one unit without coupling the reusable package to ZotLit or
package-global locale state.

## Considered Options

- **Extract only the compiler and interpreter** — leaves the
  Obsidian-specific consent, cache, and restart lifecycle duplicated by every
  consuming plugin.
- **Split compiler, runtime, and lifecycle packages** — introduces coordinated
  versioning around one pack schema without an independent consumer for any
  part.
- **Import Obsidian and render notices/settings inside the package** — couples
  reusable lifecycle policy to one UI and copy surface.

## Consequences

- The browser-safe runtime and lifecycle vocabulary are exported separately
  from Node-only compiler and Vite entry points.
- Generated runtimes own active-pack state independently.
- The workspace package remains private until publication is intentionally
  scheduled, while its API is designed as a third-party contract.
- Logging goes through an injected `StructuredLogger` port with a no-op
  default rather than LogTape, so a consuming plugin is free to pick its own
  logging stack. ZotLit gives the generated message runtime a logger that
  writes through `Effect.log*` under the `i18n` category.
- The compiler emits the Locale Catalog (base locale plus remote pack
  filenames); the consumer supplies the Pack Source (base URL and origin) and
  Locale Aliases, and composes pack URLs. Release policy stays with the
  consumer while facts the compiler already produces are never restated by
  hand.
- The package stays free of any `obsidian` dependency: each host reads
  Obsidian's language and device storage itself.

The plugin locale resolver maps Obsidian's `zh` code to the `zh-CN` catalog. The selected locale drives both the offered Language Pack and the documentation edition. Creator summaries join two names with the list pattern of the locale in which messages are rendering. A pack with no translated messages still carries that locale. Use the native list formatter for the pair so the summary does not insert bidi isolate characters.

## Obsidian startup, consent, and installation

Set the message runtime's locale and apply a validated cached pack before
the service graph builds because early notices already use the message
facade. Send synchronous runtime diagnostics to the plugin logger. Use the
bundled lifecycle copy in the target locale before installing a pack.
Resolve its Endonym from Obsidian, using the locale when none is available.
A storage read failure propagates from startup. Resource Releases supply
the pack for the running plugin version, so its Messages match that build.

Respect stored consent across starts. An accepted locale without a cached
pack starts a background refresh. A decline dismisses the offer and leaves
Settings available for later installation. Startup notice handling can
observe the refresh result even after it has settled. Give one download
the layer's Scope and let callers join it. Serialize download start and reset
admission, and commit the cache write with the corresponding lifecycle state.
A reset interrupts the download and its waiters. The active pack stays
applied until restart. A pack cached this session but never applied loses
its pending restart when cleared. See [issue 178](https://github.com/aidenlx/zotlit-repo/issues/178)
for caches retained by prior builds.

Use the same download toast from Settings and the consent notice. Start
the work once and let the toast await the result before and after the
loading delay. Distinguish an incompatible schema lineage from a transport
failure so the user sees the plugin update action. Keep the restart notice
visible longer than a normal toast. Hide the offer when another entry point
starts installation. Keep a labelled disabled button while work is pending
so the Settings row retains its control area. Hide the setting when the pack
is active or no pack exists. When a restart is pending, show the status
without an install action. Use the language name in the row and log the
artifact identity and origin. [Language Pack lifecycle](../../packages/plugin-services/src/obsidian/language-pack/service.ts) · [Notices](../../packages/plugin-services/src/obsidian/language-pack/notices.ts) · [Settings copy](../../packages/plugin-services/src/obsidian/language-pack/setting-copy.ts)
