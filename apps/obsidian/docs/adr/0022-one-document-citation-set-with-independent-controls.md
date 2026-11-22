---
status: accepted
---

# One Document Citation Set with independent controls

ZotLit derives one ordered Document Citation Set for each note and gives that same set to the References Sidebar, In-text Citation Rendering, numbering, and Citekey Navigation. The Citation Index stays an internal source of derived facts. Two source choices define membership: Pandoc Citations starts on, and Wikilink Citations starts off. Presentation and navigation are separate choices: Show Formatted Citations starts on across Live Preview and reading mode, while Open Pandoc Citations as Links starts off. This separation keeps numeric CSL results consistent and lets each setting change one user-visible effect.

This decision supersedes ADR-0020. Citation Key Links migrate to Open Pandoc Citations as Links. The managed `citekey` frontmatter field remains template output and has no role in citation resolution or membership.

## Consequences

- Eligible Wikilink Citations are unaliased Literature Note links with no fragment or a valid Citation Fragment. Heading links, block links, and malformed Citation Fragments keep their native Obsidian meaning.
- Both source choices can be off. Internal indexing and Reset Citation Index remain available.
- Source mode always shows Markdown. Live Preview and reading mode keep native source presentation while rendering is off, pending, unavailable, or unsuccessful.
- A Citation with an unresolved item stays whole and unchanged. Its resolved items still participate in the document-wide render context, so later numeric citations and sidebar entries keep consistent numbers.
- The References Sidebar remains independent from In-text Citation Rendering. It uses a minimal list when the Pandoc Engine or selected style cannot format references.
- The Citation and References Style applies to both in-text citations and sidebar references. A missing selected style keeps native in-text source, shows the minimal sidebar, warns in settings, and raises one actionable notice per plugin lifecycle.
- Citation insertion and built-in Pandoc export keep their own contracts. Source and presentation choices do not change them.
- Public theme hooks appear only while ZotLit supplies rendering or navigation for that source. Internal recognition alone has no visual effect.

## Considered options

- Preserve the existing coupled settings: rejected because the sidebar and in-text renderer can receive different citation membership and assign different numeric meanings.
- Add controls for every syntax, view, and interaction: rejected because the state space is difficult to explain and makes cross-surface consistency fragile.
- Use one membership switch for all citation syntax: rejected because Pandoc citations and Literature Note wikilinks need different defaults and independent opt-out choices.

## Numbering and presentation assertions

The document-wide citation context counts distinct Indexed Keys. It gives the same work one number across different derived spellings. Different Items whose Literature Notes share a filename keep their separate identities. Zotero can also assign the same native citekey to more than one Item. An ambiguous literal stays unresolved, while a wikilink can still name one Item exactly. A document scan can publish an update during a citation text read. The surface asks again after an invalidated result.

A note-class style's in-text presentation shows Entry Serials where its full notes cannot fit. The References Sidebar formats each full entry and shows the same serial. Tests read the rendered digits rather than the internal numbers. A numeric style's Entry Markers also keep their identities across references, popovers, and copy. A mounted popover revalidates the hovered occurrence when its note's style or language changes.

A valid Document Language controls both citeproc and the built-in export's document language. A vault Citation Locale only governs citation formatting. A style's default locale applies when both choices are absent. A note's invalid style or language keeps the original in-text citation, blocks copy, and stops built-in export even if the vault style is available and the bibliography has no resolved items. Confirming a presentation choice can write or remove both note properties in one operation.

## Presentation and cache checks

Reference slots follow document order and include only citations that identify readable works. The cache keeps an engine failure for the current inputs so repeated reads do not retry the same work. A new working database client, a style change, or a restart can invalidate the answer. Cache teardown stops a pending style read and leaves later render calls unavailable.

The cache integration acquires dependencies before opening the cache lifecycle. Tests advance style modification times by whole seconds and replace a dependent style's parent in one write so the resolver observes the change. During overlapping invalidations, a superseded render cannot publish its output. The test gives each run distinct output and holds the initial render so it can tell which replacement ultimately published.
