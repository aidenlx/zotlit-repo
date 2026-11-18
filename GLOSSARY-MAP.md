# Context Map

## Contexts

- [Zotero Data Model](./packages/db/GLOSSARY.md) — Zotero's item hierarchy, identification, and query surface as modeled by `@zotlit/db`
- [Filter Expression](./packages/filter-expression/GLOSSARY.md) — the ZotLit-owned language of filter expressions
- [Item Query](./packages/item-query/GLOSSARY.md) — field-oriented queries over top-level Zotero Items and their Annotations
- [Obsidian Plugin](./apps/obsidian/GLOSSARY.md) — literature notes, imported notes, templates, citations, and the services that bridge Zotero data into the vault
- [Obsidian i18n](./packages/obsidian-i18n/GLOSSARY.md) — Messages, JSON Language Packs, their isolated runtime, and the headless Obsidian lifecycle
- [ZotLit Protocol](./packages/protocol/GLOSSARY.md) — the wire format between ZotLit Companion, the Zotero add-on, and the Obsidian plugin: permanent `obsidian://` URIs versus ephemeral version-gated HTTP requests
- [ZotLit Documentation](./apps/docs/GLOSSARY.md) — user-facing naming and framing rules for the docs site (zotlit.aidenlx.site)
- [ZotLit Companion](./apps/zotero/GLOSSARY.md) — the Zotero-side add-on: what it observes in Zotero, and how it keeps Zotero's database readable by the Obsidian plugin
- [Fixture](./packages/scripts/GLOSSARY.md) — the generated, disposable test environment (Zotero data + profile + vault) and its build vocabulary

## Relationships

- **db → obsidian**: The data model provides typed item/annotation/attachment shapes and template-data mappers; the plugin consumes them to build note content and resolve links
- **filter-expression → obsidian**: the language defines Filter Expression syntax and its typed tree; the plugin validates Profile Match conditions against its own field vocabulary and evaluates them against Zotero Items
- **filter-expression → item-query**: the language defines ZotLit Filter Expression syntax; Item Query consumes its parse results and owns evaluation semantics
- **db → item-query**: the data model supplies Items and relation data and owns the database statements; Item Query filters, sorts, and projects them
- **item-query → obsidian**: the query core supplies one result set; the plugin exposes it through the Obsidian CLI
- **protocol ↔ obsidian**: `@zotlit/protocol` defines the URL/HTTP actions (`open`, `update`, `import-note`, `update-many`) that the Companion sends and the Obsidian plugin handles
- **templates ↔ obsidian**: `@zotlit/templates` provides the Eta rendering engine and managed-region helpers; the plugin owns template discovery, compilation caching, and the `zt.*` data contract
- **plugin packages → obsidian**: `@zotlit/plugin-kernel`, `@zotlit/obsidian-kit` and `@zotlit/obsidian-desktop` hold the plugin's shared base and use the Obsidian Plugin context's vocabulary; they have no glossary of their own and name no domain concept of their own. `@zotlit/zotero-reads` holds ZoteroReads, a concept of the Obsidian Plugin context, and uses that glossary. `@zotlit/plugin-services` holds the platform services of the Obsidian Plugin context (Local Server, Zotero Local API, Library Scope, Note Index, Use Ledger, Managed Binary, Attachment Import, among others) and uses that glossary. `@zotlit/annotations` holds the reading and annotating feature of the Obsidian Plugin context (the terms of its "Annotation view" section, such as Reader Session, Excerpt Image, Annotation Mark, Mark Popup and Open Target) and uses that glossary. `@zotlit/citations` holds the citations of the Obsidian Plugin context (the terms of its "Citation insertion", "Index and identity" and "Integration processes" sections, such as Citation Index, Citation Suggester, Document Citation Text, Citation Presentation and Pandoc Engine) and uses that glossary. `@zotlit/notes` holds the notes of the Obsidian Plugin context (the terms of its "Notes", "Templates" and "Note content" sections, such as Literature Note, Profile, Profile Match and Template Document) and uses that glossary. `@zotlit/template-workbench` holds the Obsidian side of the Template Workbench (the Template Workbench View, the Template Data Explorer, the Template Workbench CLI and the Local Bridge) and uses that glossary; `@zotlit/workbench` stays the editor core it hosts. `@zotlit/query-views` holds ZotLit Query in Obsidian (the terms of the "Query views" and "Annotation view" sections, such as Query View, Query File and Layout) and is the Obsidian host of the Item Query context; `@zotlit/library-view` holds the terms of the "Library view", "Recency" and "Releases and onboarding" sections, such as Library View, Reading Card and Welcome View; both use the Obsidian Plugin glossary
- **obsidian-i18n → obsidian**: `@zotlit/obsidian-i18n` owns Message and Language Pack semantics; ZotLit supplies its English base locale, release locations, Locale Aliases, ports, logging, consent copy, notices, and settings UI
- **obsidian → docs**: the docs site documents the plugin's user-facing surface using the Obsidian Plugin context's vocabulary verbatim; docs-only naming follows the global ZotLit Companion rule in `policies/vocabulary.md`
- **db → fixture**: the Fixture instantiates the Zotero Data Model's concepts (Libraries, Collections, Items, Citation Keys, Child Notes, Standalone Notes) as concrete generated data; the Obsidian Plugin reads that data in End-to-end Runs
- **zotero → obsidian**: the Companion keeps the main Zotero database file current so the Obsidian Plugin's Read Modes — Immutable Source above all — see recent edits; the two contexts share no code, only that file and the protocol
