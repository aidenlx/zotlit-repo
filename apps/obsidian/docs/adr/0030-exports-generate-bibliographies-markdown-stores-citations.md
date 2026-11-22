---
status: accepted
---

# Exports generate bibliographies; Markdown stores citations

ZotLit treats a bibliography as generated output. Markdown files store Citations, and each export generates its bibliography from those Citations. The References Sidebar can copy a complete current rendering as a Copied Bibliography for use elsewhere, but ZotLit does not insert or maintain bibliography content in Markdown.

## Consequences

- A Copied Bibliography is an unmanaged point-in-time snapshot. It does not update after the user pastes it.
- Copy follows the active file's Document Citation Set and Citation and References Style. Export keeps its separate citation-membership and bibliography-data contracts.
- Copy is available only for a non-empty, current, complete, error-free bibliography rendering. A refresh makes the prior rendering unavailable for copy.
- ZotLit provides no bibliography insertion command, bibliography Template, or managed bibliography region.

## Considered options

- Insert a static bibliography into Markdown: rejected because source, item metadata, locale, and style changes can leave plausible but stale content.
- Maintain a ZotLit-owned bibliography region: rejected because it makes arbitrary Markdown files share ownership with a new refresh and conflict lifecycle.

The built-in export opens its style chooser on the note's effective style. A different style selected for that export applies to its output and leaves the note's Properties alone. The shared surface tests check both the resulting document and the note after export.

## Export command checks

The export command integration keeps an available engine handle even when conversion is stubbed. Installed styles use the listing from Zotero, while other selections go through the real resolver against an empty styles directory. The picker test waits for the asynchronous list after opening the dialog. A close without an answer exercises cancellation.
