# Companion Fluent files derive from the inlang project

The Companion localizes through Zotero's Fluent runtime, whose surfaces
(`data-l10n-id`, `MenuManager` `l10nID`, `document.l10n`) take FTL message IDs
and nothing else. The handwritten `apps/zotero/locale/*.ftl` files were the one
copy source outside `project.inlang/`. We keep Fluent as the runtime and make
FTL a build output: Companion copy is authored under a nested `zotero` object
in `messages/{locale}.json`, and the Companion build compiles it into
`addon/locale/{locale}/zotlit.ftl` from the same message data the Obsidian
compiler produces.

## Considered Options

- **Run the Obsidian interpreter inside the Companion** — XUL and the
  preferences pane take IDs, not strings.
- **Keep handwritten FTL** — a second authoring source, invisible to the docs
  site and the inlang editor.
- **A shared `inlang-fluent` package** — one consumer; a module in the
  Companion's build scripts is the whole need.

## Consequences

- A nested leaf is a Fluent attribute: `zotero.menu_item_open.label` emits
  `zotlit-menu-item-open` with `.label`; a `value` leaf or a plain string
  emits the bare value. The emitted prefix stays `zotlit-`, so call sites are
  unchanged.
- `@zotlit/obsidian-i18n/compiler` exposes its message-data step (project load,
  bundle compilation, reports) apart from facade and pack emission; the
  Obsidian build excludes `zotero.`, the Companion build selects it.
- Multi-selector variants nest into Fluent selects in `selectors` order, each
  level with a catch-all; `plural` rides Fluent's implicit CLDR selection.
- Untranslated messages are omitted and warned; Fluent falls back per message
  to `en-US`. Every project locale ships in the XPI, `en` aliased to `en-US`.
- The docs site compiles every bundle and quotes Companion labels as
  `m["zotero.….label"]()`.
- The Obsidian compiler takes `includeMessages`, a list of bundle IDs that
  enter the facade and every Language Pack despite the `zotero.` exclusion,
  exported under their literal string name (`m["zotero.prefs_notify_enable.label"]()`)
  since a dotted ID is no identifier. Inlang messages cannot reference another
  bundle, so an Obsidian string that quotes a Companion label takes it as an
  input at the call site; the live-updates settings descriptions are the first
  users.
- The Companion emitter generates a typed map from Fluent ID to input names
  and types, derived from the base locale like the Obsidian facade, and
  `formatValue` / `requireMessage` / `l10nID` are generic over it.

## Emitter and build checks

Pass date inputs to Fluent as epoch numbers. Inline local declarations because Fluent has no matching local binding. A formatting-only local can produce a catch-all-only table, which the emitter reduces to a plain pattern. Omit a partly translated message as a whole because Fluent falls back by message id across the value and its attributes.

Generate `src/types/fluent.ts` from the base locale. An input-free message has type `never` in its argument map. Compare the generated file with the committed file during builds. Base messages are required, and non-base messages can only use inputs declared in the base. Check each addon XHTML localization reference against the emitted base ids. A production build regenerates stale types and fails so the generated result is included in the change. Write the compiled FTL files to staging before the package step reads it.
