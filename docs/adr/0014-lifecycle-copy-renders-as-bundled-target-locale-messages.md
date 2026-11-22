# Lifecycle copy renders as bundled Target-Locale Messages

The Language Pack consent and lifecycle copy rendered in English at exactly
the moment a non-English user must read it: the fallback ladder consults only
the active pack, and no pack is installed when consent is requested. We bundle
per-locale subsets of prefix-selected Messages (Target-Locale Messages) into
the plugin and render them unconditionally in the resolved locale, naming
languages by their Endonym from a package-owned table of Obsidian's supported
languages — accepting per-locale bundle growth so consent copy is readable
pre-consent and offline, without weakening the download-consent design for
full Language Packs.

## Considered Options

- Bundling the full translated pack and installing it without consent —
  rejected: it dissolves the consent and size design the packs exist for.
- Deriving language names via `Intl.DisplayNames` or a reserved message key —
  rejected: Obsidian's display-language set is closed, so a dedicated static
  table is simpler and deterministic across platforms.

A Target-Locale Message keeps its generated wrapper name and input
signature. Only its runtime dispatch changes. The compiler bundles the
selected subset for each remote locale and omits the base locale,
which the fallback already bundles. The runtime reads the target
subset, then the base and Message ID. It can use the subset before any
remote pack exists. Ordinary Messages use the active pack's locale,
which a caller can also use for adjacent formatting. The lifecycle
uses the resolved locale code when the Endonym table has no entry.
Its host owns pack consent, download, and cache. Consumers render one
lifecycle state at a time.

Embed lifecycle copy that must be readable before a Language Pack
loads.
