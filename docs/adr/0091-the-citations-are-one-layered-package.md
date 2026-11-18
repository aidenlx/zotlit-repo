---
status: accepted
---

# The citations are one layered package

## Context

The plugin base (ADR 0087), ZoteroReads (ADR 0088), the platform services (ADR 0089) and the annotation feature (ADR 0090) are layered packages. The citations still lived in `apps/obsidian`: citation parsing and the Citation Index, the Citation Suggester, the Document Citation Text in the editor and reading view, citekey navigation, the Citation and Annotation Popovers, Graph Citations, the References Sidebar and the Cited By Sidebar, the Citation Presentation, and the Pandoc Engine with Pandoc export. These units import one another in a dense web, and they reached into the notes feature in three places: the Citation Suggester rendered its insert through `NoteFeature`, the citekey editor created notes through the note-creation services, and the Citation Presentation read the Profile service and the default Profile's settings key for the vault's References Style.

## Decision

- **One package, `@zotlit/citations`, with three layer folders.** `core/` is host-free, `obsidian/` loads on Obsidian Mobile, `desktop/` reads Node and Electron. A layer imports only the layers below it. Lint (`no-restricted-imports`, `import/no-nodejs-modules`) holds each boundary. Pandoc export stays in the same package: it reads the citation parse, the lookup, the engine, the presentation and the styles, so a second package would import nearly all of the first.
- **The notes feature comes in through ports that the host fills.** `CitationTemplate` renders the Citation Suggester's insert, and answers an inert template as a value. `CitekeyNoteActions` picks and creates the note a citekey opens. `ProfileStyles` reads the Profile a note selects, the style it binds, and the vault's style (`vaultStyleId`), so the package names no Profile key.
- **A contract that several features offer moves down.** `ShowInLibrary` and its command go to `@zotlit/obsidian-kit`.
- **Split a file whose parts need different hosts.** The CSL style parser leaves the disk resolver for `core/`; the bibliography render tag and each popover tag leave their layers, which read Node and Electron, for `obsidian/`.
- **The Worker entry stays in the host.** `layerCitationParse` takes the Worker bundle as a parameter, as ZoteroReads does; the host builds and passes it.
- **Each unit registers itself**: service tags in `ViewServiceRegistry`, the citation slice in `SettingsRegistry`, menu events in `ZotLitMenuEvents`.
- **A test stays in the app when it reads the notes feature's Profiles** (inheritance, the default Profile slice). It moves to `apps/obsidian/src/services/citations/`.

## Considered options

- **A separate Pandoc package.** Rejected: it would import nearly every unit of the citations, and the two would move together.
- **Pass the Profile service into the package.** Rejected: the package would name the notes feature's types and settings keys.
- **A compatibility re-export in the app.** Rejected: two import paths for one module, and the app keeps its old shape.

## Consequences

- The largest folder-level value cycle drops from 29 units to 19. Eleven citation units leave it; the Annotation Suggester, which stays in the app, joins it. The package imports no unit of the app.
- A citation feature that needs a note or a Profile adds a member to a port, and the host fills it.
- Every consumer that bundles plugin code passes the package source to `effectEntry` and to Tailwind `@source`. The Lua filter's Vite plugin comes from `@zotlit/citations/vite`.
