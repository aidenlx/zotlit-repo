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

## Standalone Pandoc defaults

The saved `zotlit.yaml` and `zotlit-cite.lua` travel together. Pandoc
resolves the filter path using the directory of the defaults file.
The caller supplies the document, bibliography, CSL style when needed,
and output destination. The documented `--fail-if-warnings` option
lets a caller stop export on a failed bibliography lookup while
leaving warning policy with the caller.

Distribute the version-matched pair from the installed ZotLit build. The CLI files and guide commands accept no parameters and include the rejection hint when a parameter is supplied. For a save, obtain replacement consent and stage both files in the target directory. Mask interruption after the first target can move so installation or rollback can finish. A restore failure currently leaves no recoverable copy of an unrestored backup after staging cleanup. [Integration commands](../../packages/citations/src/desktop/pandoc/integration.ts) · [Integration save](../../packages/citations/src/desktop/pandoc/integration-save.ts) · [Issue 158](https://github.com/aidenlx/zotlit-repo/issues/158)

The reader keeps Obsidian's separator and literal text behavior.
It disables Pandoc YAML metadata blocks, the table extensions that
overlap separator syntax, and Pandoc title blocks. The Lua filter
reads opening Obsidian Properties; command-line metadata values take
precedence over the fields it reads.

## Native Pandoc filter variants

The build serves two variants from one Lua source. The variant marker
opens a region and the end marker closes it. The build rejects invalid,
nested, unmatched, or missing regions and emits only shared code and the
requested regions as a string. The CLI variant resolves through the
running Obsidian CLI. It resolves the input path once and calls Obsidian
from the input file's directory so the CLI selects that file's vault.
The sandbox reads `zotlit-resolve-map.json` that its host writes to the working
directory. The CLI map supplies citation keys, while the sandbox map
supplies temporary Item identifiers for resolution after parsing.

The CLI variant chooses a CSL file and reports the style's source on
stderr. A sole `zotlit-csl` resolves through `zotlit:csl`. A standard
Pandoc style field belongs to Pandoc. When the note supplies neither,
ZotLit resolves the note's selection from its Profile or vault. The
document's language governs citeproc independently of style selection.
The sandbox host supplies its style to the engine, so its filter leaves
metadata as written.

The `zotlit:csl` response gives either an absolute path or diagnostics. The absolute path lets citeproc open the file from the caller's working directory. Retain the selected and parent IDs for write failures. A note request can select the Pandoc default without a file and reports whether its selection came from the note, Profile, or vault so the filter can identify it. The native path uses the installed style's locale behavior with the document language, independently of the vault Citation Locale.

Store materialized styles by SHA-256 of the effective CSL bytes. Write from a private staging file and link it into place so a native run opens complete content. Reuse an existing content address and update its timestamp when possible. Log a timestamp update failure without failing resolution. The store is shared by native processes that ZotLit does not supervise, so entries age out. Reap materialized content and unknown residue after 30 days and staging files after an hour. Use modification time for both thresholds. The integration test checks that normal staging leaves no files behind. [CSL materialization](../../packages/citations/src/desktop/pandoc/csl.ts) · [Store cleanup](../../packages/citations/src/desktop/pandoc/reap-temps.ts)

Start the store sweep on the native CLI layer's Scope. This lets registration proceed immediately and unload stop the sweep. Use the shared document presentation boundary for native style selection. Resolve the distinct Indexed Keys from a note's links in one database read. Keep command flags and response text in English for a stable automation surface. [Native CLI registration](../../packages/citations/src/desktop/pandoc/register.ts) · [CLI text policy](../../apps/obsidian/policies/cli-text.md)

Resolve link targets relative to the source note. Use the decoded bare linkpath as the filter's key and keep malformed percent escapes as written so lookup agrees with the Lua filter. Resolve a repeated linkpath once. Skip ordinary notes and report a target that does not resolve to a Literature Note when the link carries the `#cite:` fragment. Fetch the Indexed Keys under one read lease. Return all discoverable errors together and withhold the citation map if any fail. A link-specific error carries the linkpath. Whole-run failures, such as lease denial, carry the database location and available read mode. [Native citation resolver](../../packages/citations/src/obsidian/pandoc/resolve.ts)

A native export with both a Pandoc and ZotLit style declaration should
stop with an ambiguity error. The existing tests cover the `csl` field
and `--csl`, which arrives as metadata. The `citation-style` alias needs
the same check. [Style ambiguity follow-up](https://github.com/aidenlx/zotlit-repo/issues/67)

The CLI reparses only the opening Properties as metadata and hands the
body back to the Markdown reader. The opening and closing fences occupy
whole lines. The code strips blank lines before the YAML because Pandoc
requires metadata immediately after the opening fence. Existing metadata,
including `-M` arguments, takes precedence. For a reparse, the reader's
extensions go into the format argument because passing reader options
alone does not preserve them.

The native tests run both variants against installed Pandoc and a stub
Obsidian CLI. A test can set `PANDOC_BIN` to select another version. With
no explicit binary and no Pandoc on PATH, the native project skips.
The stub records invocation paths, and fixtures remain under the
package's scratch directory after failure. The style fixtures render a
fixed word and an issue month to expose both style and locale. Standalone
Markdown output carries the metadata assertions. Disabling its citations
extension keeps citeproc-rendered text in the output on Pandoc 3.1.1.
Native AST assertions skip citeproc so the tests can inspect the Cite
nodes it would consume.

## Cross-surface test fixture

The Citations test runner substitutes Obsidian at the module boundary. It uses the Preact alias from the host build and asks Vite to inline `@effect/atom-react` so the library uses the same alias. Declare discovery patterns in each Vitest project because root patterns can widen project discovery. Keep native Pandoc tests in their own project and give it a DOM for the style validator's XML parser. [Vitest configuration](../../packages/citations/vitest.config.ts)

Allow the editor decoration to use the scan helper because it scans the open document, as the parse worker does. The worker-host adapter owns worker creation, release, and log transport, so the worker RPC rule exempts that boundary. The lint configuration still exempts raw Obsidian capability reads in CLI and Pandoc registration and private CSS class assertions in some tests. [Citations lint rules](../../packages/citations/oxlint.config.ts) · [Capability issue 170](https://github.com/aidenlx/zotlit-repo/issues/170) · [Test assertion issue 171](https://github.com/aidenlx/zotlit-repo/issues/171)

The host's Citation Presentation tests share one fixture for Document Citation Text, the References Sidebar, a live Citation Popover, Copied Bibliography, and the built-in export. The fixture uses one seeded Zotero database with personal and group works and matching CSL data for the bibliography service. Small styles emit distinguishable words, localized terms, or ordered markers so the tests can tell which style, locale, and work produced each result. The real Pandoc WASM runs in the happy-dom project that keeps Node's native response types. Leave time for Haskell runtime instantiation.

Hoist the module doubles before the fixture imports the tested services. Store the doubles in a runtime-independent module so mock factories can reach them while that graph loads. Replace only the external bibliography fetch, clipboard, style dialog, and host rendering seams. Reset the captured export choices and clipboard between tests. Keep the Profile registry beside the settings store because its documents are separate from persisted settings. The export uses the fixture's own settings and ZoteroReads and reads the Citation Locale through the same path as the real command.

The fixture writes the export note's Document Language into Markdown as well as metadata. Pandoc reads the source when setting the exported document's language, while the in-app views read Obsidian's metadata cache. To test the confirmed presentation action, write both properties through the actual action against a host document, then publish its cache result to the shared views. Keep a hover open across setting changes to verify the mounted popover re-reads its source. Wait for the References Sidebar to withdraw Copy before looking for the replacement render. Poll the real pane between renders instead of building a separate presentation model for the tests.

The export fixture currently reads a fixed output path. A prior successful export can leave HTML at that path when the next run stops. [Export fixture isolation](https://github.com/aidenlx/zotlit-repo/issues/100)

The citekey editor integration uses a real Note Index, settings, and fixture-backed ZoteroReads. Substitute the Citation Lookup to control ambiguous and missing results. The hover preview leaves an ambiguous citekey unresolved because showing any single candidate would imply an identity the key cannot specify.

The CSL protocol integration resolves real style files. It directs style materialization to a scoped temporary location to keep tests off the device store.

The Citation Text fixture runs the real service over the consumer test's host and service doubles. For tests of a note-class style, build the rendered `Note` with the CSL IDs parsed from the render request so the same fixture can exercise Entry Serial lookup. [Citation Text fixture](../../packages/citations/src/__fixtures__/citation-text.ts)

Build fixture settings from the platform, Reader, and Citations slices that the tests exercise. Supply unimplemented view and setting-tab services to satisfy the registry, then merge the services a test uses so they take precedence. The Profile fixture resolves by ID and supplies the vault style when a Profile leaves the binding absent. Run the real bibliography layer over fixture ports and preserve abort and bibliography error identity at its Promise boundary. Keep the initial Profile state referentially stable, since the layer filters its initial replay by identity. Use a separate DOM window to install only `DOMParser` when a test needs Node's native fetch and response. [Fixture services](../../packages/citations/src/__fixtures__/view-atoms.ts) · [Render fixture](../../packages/citations/src/__fixtures__/pandoc/render-cache.ts)

For Cited By tests, set observer idle time to zero so disposing a view releases its observer at once. The fixture can remove a file while it remains active to test how the view responds to the vault event. [Cited By fixture](../../packages/citations/src/__fixtures__/cited-by.ts)

## Pandoc runtime and data formats

Treat the pinned engine's JSON output as the Pandoc AST contract. A constructor carries its tag in `t` and its arguments in `c`; multiple arguments use a tuple. The API version vector can have different lengths across Pandoc API families. Citation IDs in the source carry Citation Key spellings. Version the native CLI response contract independently and keep its declaration outside the command handlers so integration files can read it without loading the handlers. [Pandoc AST](../../packages/citations/src/core/pandoc/ast.ts) · [Pandoc types](https://github.com/jgm/pandoc-types/blob/1.23.1.2/src/Text/Pandoc/Definition.hs) · [CLI contract](../../packages/citations/src/core/pandoc/contract.ts)

Pin the exact upstream release asset at build time and verify the SHA-256 of the uncompressed `pandoc.wasm`. Stream the verified binary with an explicit WebAssembly media type because an OPFS file can have an empty media type. The virtual filesystem belongs to the instance and is reset for each synchronous conversion. Pass Pandoc defaults through as JSON, including options the bridge does not read. Expose a named output file separately from stdout. Allocate the Haskell argument vector before taking memory views so growth cannot detach an active view. Pass `-H64m` as a suggested GHC heap size. [Build-time pin](../../apps/obsidian/scripts/pandoc-engine.ts) · [WASI bridge](../../packages/citations/src/core/pandoc/runtime.ts) · [GHC runtime options](https://ghc.gitlab.haskell.org/ghc/doc/users_guide/runtime_control.html#rts-flag--H%20%E2%9F%A8size%E2%9F%A9)

Serialize conversions because they share the runtime's virtual filesystem. Keep the newest waiting request in each named slot and reject a superseded request when its turn arrives. Release the claim when conversion starts so a later request cannot supersede the running conversion. Disposal waits for the queue to settle and refuses requests that have yet to acquire the runtime.

Prepare a document by reading its Markdown and applying its filters without citeproc. Keep the resulting AST inside the engine. Get the cited IDs from that AST and rewrite a copy for the bibliography the caller supplies. Traverse JSON records for citation IDs so a new Pandoc constructor can contain a citation without a new traversal case. Count body citations before metadata so `nocite` entries cannot take numbers ahead of the prose. Leave the `nocite` wildcard to citeproc. [Pandoc bibliography metadata](https://pandoc.org/MANUAL.html#including-uncited-items-in-the-bibliography)

Use the same Wikilink extension as the native reader. Read opening Properties through Obsidian's boundary and pass them as a metadata file. Keep body separators, block quotes adjacent to prose, and percent-prefixed body lines in the Markdown reader's input. Disable the competing YAML metadata, table, title-block, and mandatory blank-before-quote behavior.

Pass a Citation Locale to citeproc through a temporary `lang` only when the document declares none. Give the loan a conversion-specific metadata marker. Run the filter before and after citeproc to remove only the language it added and preserve a document's language and metadata. Run the bibliography heading filter while the temporary language is available.

Render an in-text citation sequence as one paragraph per source citation. Position is the join because a work's CSL ID can repeat in different citations. Fail on a paragraph-count mismatch rather than pairing a citation with the wrong source. Keep formatted affixes in the text and leave Pandoc bookkeeping behind. For bibliographies, keep the style's entry order and typed inline content. Extract the left-margin Entry Marker and drop its trailing layout space. Leave other CSL spans for the renderer.

Use the installed Pandoc binary in engine tests and allow for Haskell startup. The sandbox fixture decodes percent-encoded Wikilink targets before map lookup. Use styles with block, indent, note, and position-dependent output to exercise AST shapes. Use a localized term to distinguish citeproc's locale from the document language. Check that ID rewriting leaves the original prepared document intact. A macrotask yield in the queue test runs after the synchronous conversion. [Citation engine](../../packages/citations/src/obsidian/pandoc/engine.ts) · [Engine tests](../../packages/citations/src/obsidian/pandoc/engine.test.ts)

Set the bibliography's default heading before citeproc. Use the document language or the Citation Locale lent to the document, then the style's default locale, then English. Match a language tag from most specific down to its primary subtag. Use conventional section titles because a CSL reference term is a noun and need not read as a heading. Preserve a document's explicit heading, its bibliography placement, a closing heading, or suppression. Encode the generated strings for Lua. [Bibliography heading filter](../../packages/citations/src/core/pandoc/bibliography-heading.ts)

Pass the effective CSL XML for an installed style. For the embedded style, pass its requested locale separately so the engine can apply it without an installed CSL file. [Bibliography render layer](../../packages/citations/src/desktop/pandoc/render-cache-layer.ts)

An omitted render option inherits the vault selection. A null style ID selects the embedded style, and an explicit Citation Locale overrides the style default. Keep the original rejection message and cause for the held read and notice. Report the first unavailable selected style, and emit a new notice on a change or after that selection has cleared. [Bibliography render port](../../packages/citations/src/obsidian/pandoc/render-cache.ts)

## Formatted citation content

Share the Pandoc HTML element mapping and the spacing of CSL display spans between the live renderer and clipboard output. Flatten a display span into the same inline flow, with one space between its content and the adjacent part. The renderer uses text nodes for style and item data. Keep the wrapper with the calling surface so it can keep its existing element and classes. When the surface already supplies an anchor, render the formatted link's content as plain text. Otherwise allow absolute HTTP, HTTPS, and mail links. Relative and fragment links have no document base in this flow. [Inline content renderer](../../packages/citations/src/obsidian/pandoc/inline-content.tsx)

Keep the renderer free of effects, subscriptions, and portals so detached editor and reading surfaces can use the same flow. These surfaces return their containers directly to Obsidian and require the render to commit synchronously. Log an empty container when the flow had content. The existing test checks in the same turn so a deferred commit cannot pass.

Treat a `Note` in rendered content as the signal to use Entry Serials. Keep one slot per cited work in citation order, with a missing entry represented by an empty slot in the input and a placeholder on screen. Flows without a citation omit the slots and drop notes. The Citation Popover displays their full text by joining paragraphs with spaces. A source note inside a citation prefix follows the same path because the rendered AST supplies no provenance that distinguishes it from a style-generated note.

Keep per-document citation text state while at least one Markdown leaf shows the path. The workspace adapter notifies its owner when the set of open paths can change. [Open-document contract](../../packages/citations/src/core/citation-text/open-documents.ts)

## References Sidebar and Copied Bibliography

Keep the current scan and render when the note path, Profile readiness, and effective Citation Presentation remain equal. Keep an open-by-Indexed-Key action alive after the source pane closes and let concurrent opens finish independently. [Selection and actions](../../packages/citations/src/obsidian/references/atoms.ts)

Keep the CSL engine's typed text and Entry Marker separate so the occurrence counter can follow the entry text. Display formatted entries in the style's order. Number only formatted entries for the Entry Serial, and keep the Reference Number from the first document occurrence. A style-supplied Entry Marker retains the marker column. Reference Errors follow formatted entries in source order. With no usable bibliography, show ordinary summaries in source order. Mark an Item as unrendered only after the completed bibliography omits it. [Reference entry model](../../packages/citations/src/obsidian/references/entries.ts)

Keep missing and unresolved works visible with their source references. Show the candidates of an ambiguous Citation Key without assigning an Item. During lookup, identify unresolved rows as pending. If a readable Item has no Literature Note, let Open create one. Keep Open disabled when neither the Item nor its note can be read. Repair an invalid Citation Presentation property on the active note and distinguish that repair from an engine failure or unavailable style. [References state](../../packages/citations/src/obsidian/references/state.ts)

Allow Copy only when the active note has at least one reference and its current render has completed with every entry formatted. Carry the note path and render generation with the click so the command can refuse stale results. Give retained entries, unavailable formatting, failed formatting, and Reference Errors their own copy state.

Retain entries while a new render is pending so a refresh does not flash the minimal list. Copy stays disabled until the current note and generation own the result, even when the new note cites the same works. Read the latest snapshot immediately before serialization and clipboard write. Report plain-text fallback so the reader knows why paste lost formatting. Update the held cache key in the registry subscription to keep the model's dependency reads pure. [References model](../../packages/citations/src/desktop/references/model.ts) · [References actions](../../packages/citations/src/desktop/references/actions.ts)

Cycle through occurrences per entry and wrap at the end. Open a single Attachment directly and offer a menu for multiple Attachments. Use the resolved Indexed Key to create a Literature Note even if the Item has no Citation Key. Leave ambiguous entries without an Open action so they cannot create a note for the wrong Item.

Keep the pane's title fixed and its actions tied to the current view registry model. Use the two view-owned root classes together so the padding override matches Obsidian's selector specificity while the reference list scrolls inside the pane. The reload tests wait for a render request after the asynchronous database read. They also exercise a lookup that settles with unchanged maps, which announces the settled state without a resolution-changed event. [Pane adapter](../../packages/citations/src/desktop/references/view.tsx) · [Pane stylesheet](../../packages/citations/src/desktop/references/style.css) · [Reload tests](../../packages/citations/src/desktop/references/view.test.ts)

Keep the style action available in the fixed toolbar. Scroll the banners with the list they describe. Put a note-specific repair before the related formatting guidance. Use one banner surface for engine status and share its failure messages with settings. The banner uses the theme's muted tint and puts its action on a separate line so the message can use the full sidebar width. The close glyph aligns with the action inset and only the title reserves its space.

Use an unordered list so Obsidian's ordered-list numbering cannot double the custom markers. Share a gutter when Reference Numbers, style Entry Markers, or Entry Serials call for one. Reference Errors use that gutter when it exists. Show ambiguous candidates with their summary, Library, and Zotero key so the reader can identify the Items. Keep Jump available on error rows so the reader can repair the citation in the note.

Keep formatted text selectable and place the occurrence count on the Jump control so text selection excludes it. The badge overlays the chevron without widening the column. The Jump tooltip carries the count. Use the compact icon size token so controls fit beside the citation text and inherit Obsidian's larger mobile icon size. Reveal secondary actions with a hover-only delay and immediate keyboard focus. Apply height and opacity to the wrappers so utility classes can open the toolbar and Obsidian's disabled styling can dim individual actions after reveal. Keep supported links as anchors so Obsidian can open them in the system browser. [References pane](../../packages/citations/src/desktop/references/References.tsx) · [Pane tests](../../packages/citations/src/desktop/references/References.test.ts)

Copy the same entry order and Entry Markers as rich HTML and plain text. Use one paragraph per entry and let the destination supply its heading. Serialize formatting with portable HTML elements and keep a small-caps declaration on the output element so it survives paste without ZotLit CSS. Omit document-specific notes, breaks, and raw markup from the rich paragraph. Collapse ASCII layout whitespace between words and keep meaningful non-breaking and thin spaces between initials. Parse rich test output as a destination would so the checks cover the markup's meaning. [Clipboard serialization](../../packages/citations/src/obsidian/references/copied-bibliography.ts) · [Issue 161](https://github.com/aidenlx/zotlit-repo/issues/161)

## Cited By Sidebar

Share previews, file sort facts, and revision tracking across all panes. Invalidate only the paths named by a metadata change, rename, or deletion, including both paths of a rename. Limit preview parsing to one note at a time so a long list cannot saturate the host. Read the metadata cache after the parse. Keep the previous preview during a refresh and show an unavailable state on failure. Include collapsed groups in preview reads so search can match their text. When a click targets a citation, check the occurrence against the current source. Open the note alone if the source is unavailable or the occurrence no longer matches. [Preview and navigation atoms](../../packages/citations/src/obsidian/cited-by/atoms.ts)

Keep each leaf's model mounted from construction through close because Obsidian can restore state before the UI subscribes. Decode each saved search, context, and sort control independently so an invalid field leaves the others usable. Reset collapse state and manual expansions when the followed Literature Note changes. Drop expansions for a changed citing note because their offsets address the old source. [Leaf model](../../packages/citations/src/obsidian/cited-by/model.ts)

Use the six Backlinks sort modes, grouped in pairs. Compare filenames without case distinctions and compare embedded numbers numerically. A stable sort preserves the Citation Index's vault path order for ties and leaves occurrences in source position order. A vanished file falls back to its path name and zero timestamps. Match the host's pane padding rule with two view-owned classes. [Sort and excerpt rules](../../packages/citations/src/obsidian/cited-by/store.ts) · [Pane styles](../../packages/citations/src/obsidian/cited-by/style.css)

Keep the compact Citation Context on the occurrence's source line and use the same character cap as Obsidian search. The full context uses the enclosing list item and its descendants, or a Markdown section, with the source line as fallback. Start a list excerpt at the line start to retain its marker and indent. Ellipses indicate the compact cap and disappear in full or manually expanded context. Show chevrons when meaningful source remains on that side. Expand by the adjacent logical chunk, with list items first, then a Markdown section, then a line. Combine a manual expansion with the active context range so it can only widen the excerpt.

Apply a search query after the input debounce. Focus the search field when it opens, and give the visible placeholder a matching accessible name. A matching path keeps its whole group. Otherwise match only the loaded Citation Context for each occurrence. Keep the results region when search hides every group and reserve the empty-state messages for the unfiltered Citation Index result. Count the visible notes and occurrences. On narrow panes, put the counts beneath the centered actions.

Present each occurrence as a search-result card with its citation highlighted. Reveal its context controls on hover and keyboard focus. A hidden chevron does not intercept pointer clicks on the card. Context activation stays on the chevron so the card does not open the note.

Request a workspace save when a persisted control changes. Preserve the observer and per-Item state when following another path for the same Item, while updating which group is labelled This note. The tests use a duplicate Literature Note to exercise both effects. Keep test preview reads interruptible and poll over host turns. Cancel every started parse on close. Releasing a cancelled parse can let one queued parse start before the teardown reaches it. [Cited By component](../../packages/citations/src/obsidian/cited-by/CitedBy.tsx) · [View and persistence](../../packages/citations/src/obsidian/cited-by/view.tsx)

## Citation navigation

Use the shared open-or-create flow for a single cited work and the cited works menu when several are available. Keep unresolved work labels in the source spelling. Follow Obsidian's modifier-to-pane mapping and use `mousedown` for middle-click. A plain Source mode Mod-click that maps to a tab opens in the current pane. Mod+Alt keeps its split and Mod+Shift keeps its new tab.

When Citations stay closed as links, a plain click reveals their source in Live Preview and leaves text selectable in Reading view. Mod-click still navigates. For rendered Wikilink Citations, stop an intercepted plain click before it reaches Obsidian's delegated handler. Leave Mod-click and middle-click to that handler. Attach listeners to the citation element so they leave with it. Use the private `data-zt-click` attribute for the click affordance and the public theme classes for theme integration. The anchor stylesheet gives this affordance precedence over Obsidian's unlayered cursor rules.

Check hover settings and modifiers at the time of each gesture. Ignore movement within the same citation and explicit pen or touch pointer types, with an ordinary mouse event allowed to omit its pointer type. The Citation Popover honors the mode's Require Mod setting, can show several works or an unresolved entry, and receives occurrence data from formatted surfaces to display a style-generated note. In Popover mode a Wikilink Citation owns the hover even while it waits for Mod, so Obsidian's delegated Page preview cannot also open.

Page preview takes one already resolved Literature Note and uses the shared citekey hover source. Use the source's Page preview toggle when present and its registered default otherwise, as observed in Obsidian 1.14.4. Page preview performs no open-or-create action. Keep the latest settings in each Wikilink Citation surface, redraw only when display or listener ownership changes, and use the first replayed snapshot to seed state without a redundant redraw. [Navigation handlers](../../packages/citations/src/obsidian/citekey-navigation/citation.ts) · [Gesture mapping](../../packages/citations/src/obsidian/citekey-navigation/shell.ts) · [Wikilink display settings](../../packages/citations/src/obsidian/citekey-navigation/wikilink-display-settings.ts)

Mirror Obsidian's open-link palette commands in the desktop plugin. Gate them on navigation separately from formatted display. Pick an existing Literature Note through the Notes feature, which can report other matches. If no note exists, create one, asking for a Profile when needed. Route an Ambiguous Citation Key to a picker and open its selection by exact Indexed Key. Keep the candidate's Library visible in both wide and narrow rows. Log failures at the open boundary and let unload interrupt pending opens. Leave the hover path untraced because it runs on every citation hover. [Palette commands](../../packages/citations/src/obsidian/citekey-editor/actions.ts) · [Open service](../../packages/citations/src/obsidian/citekey-editor/service.ts)

Register the Page preview hover source, Annotation Link extension, and mutable citekey extension array once in that order. Update the array and reconfigure the editor when the treatment switches on or off. Keep Annotation Citation rendering independent of the Pandoc Citation setting. Keep hover settings current without rebuilding the drawn widgets. Redraw when held Citation Text changes. A literal key can sit inside an external-link token, so map its local colour variables to the internal-link appearance. Preserve the unresolved accent on hover and omit the external-link icon beside a formatted Annotation Citation. [Editor registration](../../packages/citations/src/obsidian/citekey-editor/register.ts) · [Editor styles](../../packages/citations/src/obsidian/citekey-editor/style.css)

Use Obsidian's token and line classes to exclude code, math, comments, Properties, and autolinked URLs from literal Citation Key decoration. The exclusions depend on the 1.13 token vocabulary. Separate click-range parsing from resolution state so a command can locate a key without reading lookup state. Mark `@key` for navigation, leaving the author-suppression hyphen outside the mark. Replace the complete Citation for formatting, including that hyphen, because the style formats the whole cluster or author-in-text citation. Drop marks covered by the replacement and retain the footnote superscript class when the original token wrapper would be lost. [Literal decoration ranges](../../packages/citations/src/obsidian/citekey-editor/decorate.ts)

Use an outer mark for each Durable Annotation Link because Obsidian does not emit `hover-link` for external links and Source mode renders their text and URL in separate spans. Anchor one popover to the whole mark and ignore movement within it. Scan contiguous link tokens across whole visible lines, including the single `[]` token for the empty-text form. At a shared boundary, prefer the link that begins there. The token fixtures follow Obsidian 1.14.4. [Annotation Link extension](../../packages/citations/src/obsidian/citekey-editor/annotation-link.ts)

In Live Preview, replace an empty Annotation Link only when Document Citation Text supplies its formatted parent citation at that position. Keep the native link while its text is pending or absent, and reveal its Markdown on selection overlap. Keep mapped decorations during composition, an incomplete syntax tree, or a held mouse. Make the replacement atomic for cursor motion and deletion. Reuse its wrapper for Annotation hover and follow clicks through the same global entry point File Link Capture intercepts. [Annotation Link tests](../../packages/citations/src/obsidian/citekey-editor/annotation-link.test.ts)

Keep source marks and formatted Citation widgets in separate decoration sets. Give widgets higher precedence so Obsidian's empty bracket replacement cannot cover the whole Citation during a widget-only redraw. Let cursor motion and Backspace treat each widget range as one unit. During composition, an incomplete syntax tree, or a held mouse, keep the mapped decoration set. Recalculate which source to reveal on selection and focus changes, and decorate each line once when two visible ranges share it.

Resolve marked keys through the current editor observation and use the same state classifier for keys and widgets. The delegated hover and open handlers skip widget elements, which own their gestures. Let native mouse selection handle a drag and extended selection. After an ordinary click on a closed Citation widget in Live Preview, move the edge caret into the revealed source. Keep a Source mode plain click available to CodeMirror and let modifier navigation follow Obsidian's pane rules.

Match formatted text to the occurrence's document offset. On a fresh value-equal read, retain the widget element and refresh its popover metadata so a later hover uses the new position. A footnote token that surrounds the entire replacement supplies the superscript styling itself. Apply it directly only when a footnote token overlaps the range and does not enclose it, to avoid shrinking the glyphs twice. The tests use a zero-width viewport with an empty syntax tree to exercise external invalidation without emulating Obsidian's background parse. [Literal Citekey Editor extension](../../packages/citations/src/obsidian/citekey-editor/extension.ts) · [Editor tests](../../packages/citations/src/obsidian/citekey-editor/extension.test.ts)

## Citation Popover visits and layout

Open on Obsidian's hover delay, then fill the card as the read settles. A render invalidation or a change to the hovered document's metadata starts another read. Read entries, Entry Serials, and occurrence-specific note text from the current Citation Presentation so the result agrees with the References Sidebar. A standalone work can supply an Annotation above the bibliography entry. Its first read ends when the work draws or the visit ends.

Run each read and each standalone work's action lookup in the visit's scope. A replacement read interrupts the previous one. When an action starts, read the displayed work again by exact Indexed Key so its actions use the current Item and attachments. A failure to refresh can show a database status with the last result still visible. A pending lookup marks an unresolved block as still loading. Log failures in the draw as well as failures in the data read. [Desktop layer](../../packages/citations/src/desktop/citation-popover/layer.tsx)

For a standalone work, wait for the settled bibliography render before replacing its entry. Keep the Annotation lead by itself when Citation Lookup has no parent Item or a standalone PDF has no usable Item entry. For a document Citation, resolve presentation through the metadata and Profile services in the current read, then read fresh Document Citation Text to restore the serials and style-generated note for the hovered occurrence.

Stack one block per hovered work in citation order. Join reference entries by Indexed Key because multiple spellings can name the same item. Keep a summary and item actions when the engine is unavailable or left a readable work out of the bibliography. A missing work shows an unresolved block or the candidates from Citation Lookup. Show the bibliography's Entry Marker when it has one and use an Entry Serial for an unmarked entry in serial mode. Keep attachments in library order. [Block model](../../packages/citations/src/obsidian/citation-popover/blocks.ts) · [Service](../../packages/citations/src/obsidian/citation-popover/service.ts)

Keep one popover per hover parent and replace it when the target moves to another window. Before retargeting within a window, clear the drawn content and dispose the previous target's reads and subscriptions. Give each target a fixed snapshot of its state so an old read cannot acquire the new target's state through the registry. Obsidian owns the popover lifecycle. ZotLit mounts a single content root during the opening delay and asks the host to reposition when its contents resize. [Visit registry](../../packages/citations/src/obsidian/citation-popover/visits.ts)

Give the content root its own scroll area because Obsidian clips the outer popover. Use the host width for entries with actions and fit a lone status line to its text. Read the host's inline bottom or top position each time it places the popover. Use a class derived from that position to keep the action row on the side nearest the hovered citation. [Host popover](../../packages/citations/src/obsidian/citation-popover/popover.ts) · [Styles](../../packages/citations/src/obsidian/citation-popover/style.css)

Use the shared inline renderer and gutter for selectable bibliography entries. For a note-class style, show the hovered occurrence's note once and group its action rows in citation order. Label each row with the corresponding inline Entry Serial and the same public theme class. Use the missing-entry mark for a work without a bibliography entry and an ellipsis while its lookup is pending. Keep each row distinct when a citation repeats a key. Keep the action row visible and use the compact icon size from the sidebar. Omit the Attachment button when the displayed item has no Zotero-Openable Attachments. [Popover content](../../packages/citations/src/desktop/citation-popover/content.tsx)

Use Obsidian's modifier-to-pane mapping for the Literature Note action and handle middle-click as a tab request through the auxiliary click handler. Open one Attachment directly and offer a menu for several. Capture the button bounds and owner document before an asynchronous Item refresh because the event loses its current target after dispatch. Dismiss the card when the action reports completion. An attachment list that becomes empty or unreadable during refresh keeps the card open, as the amendment "citation presentation follows state changes" states. [Popover actions](../../packages/citations/src/desktop/citation-popover/actions.ts) · [Issue 165](https://github.com/aidenlx/zotlit-repo/issues/165)

In lifecycle tests, let the document-text read wait for its abort signal so retarget, hide, and unload must release it. Advance the runtime clock for asynchronous Zotero reads before checking the render or an exact-item action. Simulate a target crossing windows by changing its owner window. Hide each test popover before resetting timers because it can still attach to the shared document when its opening timer fires. In the database recovery test, acquire a validated connection before locking its item table to exercise a failure in the item read. [Lifecycle tests](../../packages/citations/src/obsidian/citation-popover/lifecycle.test.ts) · [Service tests](../../packages/citations/src/obsidian/citation-popover/service.test.ts)

## Document Citation Text occurrence matching

Use the source spelling for a literal Citation and add the ordered Indexed Keys to the identity of a derived Citation. Two derived Citations can share a spelling and resolve to different works. Keep occurrences in document order and leave one content slot per work. Deduplicate literal keys in the navigation menu and use the source spelling for unresolved labels.

Match editor occurrences by source offset and Reading view occurrences by their position within the rendered section. Display can fall back to the first occurrence when the coordinate is absent or stale. A mounted Citation Popover that supplies a coordinate requires a match before it shows a style-generated note. Compare formatted content independently of position data so that a coordinate update can keep the existing element and its popover anchor.

Use the current document's result for readiness. Read pending status and ambiguity from the same resolution snapshot, keep pending entries neutral, and show missing status before ambiguity. Keep the public theme classes consistent across surfaces. Render formatted content into the element each surface owns and render style links as text inside an existing anchor. [Presentation](../../packages/citations/src/obsidian/citation-text/present.ts) · [Presentation tests](../../packages/citations/src/obsidian/citation-text/present.test.ts)

## Document Citation Text retention and rendering

Hold Citation Text and its Citation Lookup snapshot by vault path. A disabled query observer keeps an open document's text available without starting a read. Other text, including an embed's text, expires five minutes after its last observer leaves. A synchronous peek starts or refreshes the read and can return a stale answer. The Citation Popover waits for the shared read to settle. Resolve the path at each read and check it again after an asynchronous read so deletion cannot publish text for a missing file. Keep the stored value when a new result is equal, and emit the settled event even for an equal or failed read.

Wait for the Note Index and Citation Lookup before rendering a document. Feed all resolved citations to CSL in document order so a position-dependent style counts every relevant occurrence. A partial Citation Cluster contributes its resolved works and keeps its complete native source on screen. Format Literature Note Wikilinks from the Pandoc source export would produce. Take their membership and resolved works from the Document Citation Set and their separators from the note body. Durable Annotation Links use their own source as the display lookup key.

Use the document's Citation Presentation and shared bibliography render cache. A present but empty presentation property keeps native source. Use Indexed Keys for inline CSL input and item identities for the bibliography. When any inline result contains a style-generated note, use Entry Serials throughout the document. Read those serials from the same ordered bibliography as the References Sidebar, and retain an empty slot when a work has no entry.

Invalidate a document on metadata changes because locators and prefixes can change independently of citekey membership. Keep the last result visible until its replacement arrives. A second invalidation cancels the in-flight read and leaves the entry stale so the next caller starts a new read. Invalidate across documents when Literature Note mappings, Citation Lookup revisions, or render inputs change. Refresh the open document pins on workspace changes and vault renames. Set up those subscriptions before the first workspace read so a later event can retry pinning after a startup failure. Stop new work before closing the query and event scope. [Citation Text service](../../packages/citations/src/obsidian/citation-text/service.ts)

Test the literal and Wikilink Citation joins with separate Indexed Keys. A Wikilink Citation can resolve when a literal key with the same spelling has no match. A Wikilink Citation without a native key falls back to its note filename and stays out of the render if that filename cannot form a Pandoc key. Use Vitest's host clock for Query Core garbage collection and Effect's TestClock for Held Read cooldowns. Enable the host timers before the read schedules collection, and let the clock advance while the read runs. [Citation Text service tests](../../packages/citations/src/obsidian/citation-text/service.test.ts)

## Durable Annotation Links in Reading view

Attach a hover listener directly to each Durable Annotation Link because Obsidian sends no `hover-link` for external anchors. Let the section's render child own the listener and unload any remaining children on service disposal. Ignore pointer movements within the anchor. Use the containing Markdown view as the hover parent. The hover opens the parent Item's Citation Popover with the Annotation above the reference. Resolve links in the Annotation's comment against the source note. Run hover and Literature Note open requests in the reading service's scope so unload interrupts pending work.

Keep Obsidian's native anchor and link target. Fill links with empty text from Document Citation Text and keep author-written link text intact. The anchors carry no source offset, so match empty links to successive occurrences of the same Annotation in the current section. When the host supplies no section coordinates, use document order across the note. Rewrite held sections in place on a Citation Text change. A fresh settled result that omits an occurrence restores the native link, as the amendment "citation presentation follows state changes" states. Re-render the Reading views when the setting changes or the service unloads to restore native links. Remove the external-link icon with an unlayered rule because the host styles its anchor outside the plugin's CSS layers. [Reading service](../../packages/citations/src/obsidian/annotation-popover/reading.ts) · [Style](../../packages/citations/src/obsidian/annotation-popover/style.css) · [Issue 166](https://github.com/aidenlx/zotlit-repo/issues/166)

Exercise visible hover content in the running app. Use focused tests for listener disposal, stale reads, and release of Excerpt Image reads. To exercise two hovers that resolve out of order, load both Attachment lists from the real repository and gate their delivery to the popover independently. The real repository serializes those reads. Use plain text in place of the host Markdown renderer in the service harness. For image decode failure, feed one red pixel through the real Excerpt Image display and dispatch the failure event in the fixture. [Reading tests](../../packages/citations/src/obsidian/annotation-popover/reading.test.ts) · [Service tests](../../packages/citations/src/obsidian/annotation-popover/service.test.ts) · [End-to-end Run](../../packages/e2e/src/annotation-links.e2e.ts)

Build the Annotation lead from the same excerpt, image, and locator components as the Annotation View. Pass the stored Zotero colour through a CSS property so the border and page label share it. Use the shared Excerpt Image display for image and ink Annotations, including when the reader is closed. Let the popover component own rendered comments so they unload with it. [Annotation content](../../packages/citations/src/desktop/annotation-popover/content.tsx)

Hold the Attachment's Annotation list while its visit is open. Read it again when the repository publishes a change. Unsubscribe before releasing the hold because release can publish a change. Use a generation for each read and invalidate it when the target changes or the popover hides so a late read or image request cannot draw. An interrupted read returns without drawing. An unanswered read can keep the existing lead visible. A resolved list that lacks the Annotation shows the unavailable status. The core logs a current read failure and shows the same status so the Citation Popover can start the lead without waiting for it. [Annotation Popover core](../../packages/citations/src/desktop/annotation-popover/popover.tsx)

## Literal Citation Rendering in Reading view

Keep one Markdown post-processor for the plugin lifetime. Determine formatting and navigation separately from current settings. Refresh the view when settings change which citations receive treatment or when unload must remove handlers. Read current hover settings at gesture time. Bind popovers to the containing Markdown view and skip them in detached sections.

Read literal citations from rendered text nodes. Leave code, math, metadata, and links to their own rendering paths. Swap spans from the last occurrence to the first so splits preserve the earlier offsets. Keep the enclosing block in place so sidebar navigation can flash it. Use section coordinates to select the occurrence-specific text for position-dependent styles.

Use the shared Document Citation Text so Reading view, Live Preview, and References agree on presentation. Keep raw source before the first answer and retain the visible text while its replacement is pending. Scope lookup to its rendered section. Rewrite the live sections for a changed document, or all live sections on global invalidation. Retain equal citation elements so an active popover keeps its anchor, and refresh the navigation state it reads. A retained element refreshes its Imported Note Profile diagnostic, as the amendment "citation presentation follows state changes" states. A fresh settled result with no formatted text for a citation restores its source text, as the amendment "Reading view citations return to source text" states. [Reading service](../../packages/citations/src/obsidian/citekey-reading/service.ts) · [Issue 162](https://github.com/aidenlx/zotlit-repo/issues/162) · [Issue 258](https://github.com/aidenlx/zotlit-repo/issues/258)

Keep unresolved and ambiguous citations wrapped for styling even when they have no direct click action. Use the host's internal-link variables, with unresolved decoration on ambiguous citations and hover colour reserved for ordinary open affordances. [Renderer](../../packages/citations/src/obsidian/citekey-reading/render.ts) · [Reading style](../../packages/citations/src/obsidian/citekey-reading/style.css)

## Wikilink Citation Rendering in Reading view

Use Obsidian's native internal anchor and read its full target from `data-href`. The default breadcrumb joins target segments with `>`. Leave aliases alone, including an alias whose text equals that breadcrumb, because Obsidian marks an author alias with `aria-label`. Leave links with text from another post-processor and embeds alone. The test fixture models these attributes. Join only anchors in one parent with text-only separators that qualify as a Citation Run. A paragraph boundary or intervening element breaks the run. [Native anchor fixture](../../packages/citations/src/__fixtures__/wikilink-reading/internal-link.ts) · [Reading renderer](../../packages/citations/src/obsidian/wikilink-reading/render.ts)

Keep the native anchor, target, and classes when formatting succeeds. For a run, remove its later anchors and separators and retain the first work's navigation target, as in Live Preview. Render style-generated links as text within that anchor to avoid nesting anchors. Drag and context-menu Copy carry the rendered text. Keep a run's native appearance and gestures until formatted text arrives, and use section coordinates for position-dependent formatting.

Keep one Markdown post-processor and hold sections with internal links so a newly resolved Citation can appear without another host render. Update affected sections on document text publication and all held sections on global invalidation. A Literature Note mapping change requests new Reading views because it can change which links qualify. Refresh gesture listeners on each rewrite and retire the treatment on unload. Preserve the first anchor for an existing run. Candidate discovery skips the anchors that the section already rendered, by identity, so a formatted text equal to its native breadcrumb is not admitted again. This was fixed on 2026-11-23 in [PR 245](https://github.com/aidenlx/zotlit-repo/pull/245). [Reading service](../../packages/citations/src/obsidian/wikilink-reading/service.ts) · [Issue 163](https://github.com/aidenlx/zotlit-repo/issues/163)

Attach Citation Popover and plain-click interception only to formatted runs that need those gestures. Leave other gestures to Obsidian. Style a non-opening anchor with plain CSS rules so the cursor and hover colour can override Obsidian's unlayered link rules. [Reading styles](../../packages/citations/src/obsidian/wikilink-reading/style.css)

## Wikilink Citation Rendering in Live Preview

Read Obsidian's HyperMD token classes to identify a closed link with nonempty interior. Keep the 1.13 token vocabulary in the scanner, so unfamiliar tokens do not produce a replacement range. Split the target at the alias separator, trim it, and normalize it to NFC. Keep the whole link range for the occurrence offset and the interior range for replacement. Recover the first interior token's classes on the widget because the replacement removes the native marks. [Live Preview link scan](../../packages/citations/src/obsidian/wikilink-editor/scan.ts)

Leave embeds and aliases to Obsidian and end a Citation Run at either. Replace a run as one grouped citation. Expand its reveal boundary over the members' full conceal groups, including adjacent link and inline-marker tokens. This keeps the whole run's source visible when the selection overlaps it. A blurred editor supplies no selection for reveal. Obsidian's search highlight that touches a run also reveals its source, as the amendment "citation presentation follows state changes" states. [Decoration ranges](../../packages/citations/src/obsidian/wikilink-editor/decorate.ts) · [Issue 164](https://github.com/aidenlx/zotlit-repo/issues/164)

Register a mutable extension array once and empty it on unload. Rebuild decorations when shared document text changes, and refresh all editors when a Literature Note mapping changes. Keep native presentation until the first formatted result arrives. Apply native link colours and cursor through the widget's own class because Obsidian's descendant selectors do not match the reconstructed classes on a single element. The gesture tests put the delegated listener above the editor and stub coordinate lookup because happy-dom supplies no layout. [Editor service](../../packages/citations/src/obsidian/wikilink-editor/service.ts) · [Editor styles](../../packages/citations/src/obsidian/wikilink-editor/style.css)

Build inline replacements from visible-line tokens and the held Document Citation Text. A view plugin can provide the decorations because the replacements stay within a line. Keep default precedence because Obsidian's original marks cover the replaced range and cannot wrap the widget. Preserve and map the current decorations while the syntax tree is incomplete, the input method is composing, or the mouse is down. This avoids temporarily dropping citations or moving text during a drag selection.

Reconstruct the host's link-text class and make the widget draggable so Obsidian can resolve native gestures from its document position. A run maps to its first work for click and drag, while its popover lists all works in order by Indexed Key. Render style-generated links as text inside the widget so they leave the native gesture target in place. Install capture listeners on the editor element only for the gestures ZotLit owns. This puts them ahead of Obsidian's delegated handlers and lets them survive widget replacement. A captured plain click can place and focus the caret, so the next decoration build reveals the source.

Keep widget metadata in a weak map keyed by its element. Reuse the widget for the same held content. When a fresh answer is value-equal, keep the element and update the metadata that delegated hover reads, including the occurrence coordinate. [CodeMirror extension](../../packages/citations/src/obsidian/wikilink-editor/extension.ts)

## Citation Suggester and insertion

Try the Bracket Trigger before the optional At Trigger. The bracket form permits spaces and search punctuation, and consumes an adjacent closing bracket. The At Trigger requires a word boundary, lets an underscore stand for a space, and leaves a following bracket in place. A trailing slash requests the alternate Citation Variant. A comma after a recognized Citation Key leaves locator editing to the editor. [Editor suggester](../../packages/citations/src/obsidian/citation-suggest/editor-suggest.ts)

Use one Item Lookup session for an open dropdown. Give a warm document index 150 ms to supply cited keys and continue searching without them when the read cannot complete. Suppress a superseded answer with null where an empty list would close Obsidian's dropdown. While the new query is pending, Enter waits for its first row and a click on an older row does nothing. Two Items can have the same visible title. Use matching CSS and JavaScript title limits so truncation and highlight placement agree, and cap the Library label to keep it from displacing the title. [Document citation read](../../packages/citations/src/obsidian/citation-suggest/document-citations.ts) · [Suggestion styles](../../packages/citations/src/obsidian/citation-suggest/style.css)

Share insertion logic between the inline suggester and command modal. Refuse an ambiguous key because the inserted text carries the key alone and would lose the selected Item identity. Require a lookup result before deciding that a key is safe to insert. Present the Citation Template's inert result as a notice and treat null as a template still loading. Check that the editor still contains the captured text when the result returns. Record Use only after a nonempty insertion succeeds. Register Shift+Enter explicitly in the modal because Obsidian's default Enter handler matches modifiers exactly. Return false to consume that chord. [Insertion modal](../../packages/citations/src/obsidian/citation-suggest/insert-modal.ts)

## Citation Index view and recovery

Key Cited By observers by Indexed Key so leaves share a subscription and a rename or duplicate Literature Note keeps it alive. Release an old observer after its last reader leaves. Listen to lookup publication even when recovery keeps the same revision. Track document changes by path and membership changes across paths so readers can refresh only the affected document. [Index view atoms](../../packages/citations/src/obsidian/citation-index/atoms.ts)

Use Obsidian's public `setEphemeralState` entry point with the state fields observed in its 1.13 Search and Outline paths. Supply both `startLoc` and `endLoc` for the exact editor flash, and `line` for the reading-view block flash. Use null for an editor end at the end of the document. Omit `match` when setting `line` to avoid a second reading-view scroll. The editor flash lasts until Escape, a click, or another flash. The reading-view flash lasts three seconds. [Occurrence reveal](../../packages/citations/src/obsidian/citation-index/reveal-occurrence.ts)

Confirm reset before clearing stored scans. Announce the rebuild without claiming the background scan has finished. Cancellation needs no notice. [Index reset action](../../packages/citations/src/obsidian/citation-index/reset.ts)

Keep command reads fresh and allow an open view to hold its last complete answer across a request change or failed refresh. Each observation pins only its own query. Preserve the terminal publication so a late subscriber can observe closure. Start the first refresh without holding up layer construction. Yield before waiting for refresh so queued dependency changes can start their replacement attempt. Annotation parent links can change without a new Citation Key snapshot revision, so compare the requested parents before reusing an answer. Defer editor requests beyond the CodeMirror update and apply only the latest request that still belongs to an open editor. [Lookup service](../../packages/citations/src/obsidian/citation-index/lookup-service.ts) · [Editor lookup](../../packages/citations/src/obsidian/citation-index/editor-lookup.ts)

Resolve each occurrence by its syntax. Use the Citation Key snapshot for literal keys, the Literature Note for wikilinks, and the current parent Item for Annotation Citations. Group occurrences by Indexed Key across syntaxes and assign Reference Numbers in first-occurrence order. Keep unresolved Citation Keys visible under their original spelling and omit wikilinks to ordinary notes. A note can become a Literature Note without moving its occurrences. Compare the resulting Citations structurally so broad metadata refreshes leave an equal result in place. [Citation grouping](../../packages/citations/src/obsidian/citation-index/query.ts)

Show ambiguous candidates in snapshot order with a summary, Library name, and bare Zotero Item key. Open a selection by its exact Indexed Key so it never resolves the Citation Key again. Use the joined sources when a document read already captured them. Otherwise read summaries in the caller's fiber, propagate interruption, and use the Item key when the read fails or yields no summary. An unknown Library has no label. Use the surrounding surface's text styling for candidate rows. [Ambiguity resolution](../../packages/citations/src/obsidian/citation-index/ambiguity.ts) · [Candidate rows](../../packages/citations/src/obsidian/citation-index/ambiguous-candidates.tsx)

Pair a parsed record with the source generation the parser received. Retry if the path or file statistics change during the parse. In scanner-revision tests, race the parse entry against completion of indexing so a skipped stale record fails an assertion instead of leaving the test waiting. Test that a Library beyond the saved scope is handled when availability changes, and exercise query retention with fake timers outside the Effect clock. [Parsed note](../../packages/citations/src/obsidian/citation-index/parsed-note.ts) · [Lookup tests](../../packages/citations/src/obsidian/citation-index/lookup-service.test.ts)

Store raw occurrences and resolve their Item identities at query time. Carry the validated Citation Fragment or Annotation page locator with the source position when present. Compare semantic fields and source offsets so a content-identical touch leaves the current result in place. In the citekey editor, blank closed single-line wikilinks without shifting offsets. Pandoc treats their inner text as part of the link. Leave an unclosed opener as text and let the editor's syntax tree handle the other exclusions. [Occurrence scanning](../../packages/citations/src/obsidian/citation-index/scan.ts)

Read the source join through ZoteroReads so References can work while Zotero is closed. Use one snapshot for Items and batched Attachments, since the Attachment lookup depends on the Item IDs in that snapshot. Preserve the distinction between readable sources, present child Items, and an unreadable database. Use the CSL ID for rendering, the shared summaries for display, and the Indexed Key and linkpath for navigation. If the Attachment read fails, keep the citation sources and omit the Attachment action. Offer stored files and linked-file paths in library order, and read the last path segment using either platform's separator. Exclude bare web links and malformed storage paths. [Reference source join](../../packages/citations/src/obsidian/citation-index/sources.ts)

On unload, interrupt active readiness waiters and let a caller arriving after shutdown observe the stopped state immediately. The scoped reset transaction can continue independently after the original waiter is interrupted. The lifecycle test holds another finalizer to observe the reset backfill during shutdown. [Index lifecycle tests](../../packages/citations/src/obsidian/citation-index/lifecycle.test.ts)

Keep raw scans and membership in the renderer and send Markdown parsing to the parse client. Scan the active document on demand if the backfill has yet to reach it. Keep the held scan available during a grammar update, but require a current scan for occurrence navigation. Graph Citations reads the currently covered paths in vault order and uses their occurrences in document order. A failed backfill can settle with degraded coverage. Keep per-file intake, storage, and coverage helpers untraced because they run on every scanned file.

Feed metadata and rename events into one ordered intake inside the Obsidian callbacks so a change and rename in the same turn are applied in order. Apply citation syntax settings to membership while scanning and lookup continue. Limit how long startup waits for IndexedDB and apply scans and drops to the store when it opens late. Queue per-file persistence in the layer scope. The index can rescan derived records after a write failure. Stop intake before closing the child scope and prevent an older build from writing after a reset. The reset test holds a pre-reset read and verifies that a restart can use the replacement record without rereading the note. [Index service](../../packages/citations/src/obsidian/citation-index/service.ts) · [Index service tests](../../packages/citations/src/obsidian/citation-index/service.test.ts)

Register the reverse observer before publishing its first snapshot. Update it on progressive scans, lookup changes, and source settings. An Ambiguous Citation Key leaves one unresolved Citation in the forward direction and contributes no CSL work. In reverse it reports a possible relationship for each candidate. Keep the excluded-syntax walk out of live snapshots. For a document answer, an excluded malformed Wikilink Citation can count when it resolves to an Item and would add a Reference Error. For a Cited By answer, count only eligible occurrences of the selected Item.

Build the real Citation Lookup over the consumer fixture's existing dependencies. Native tests supply a real RPC client. The extension double deliberately delivers strict requested answers asynchronously and keeps the previous answer during a refresh. Ambiguity fixtures include personal and group Items and give the group Item a lower numeric ID to expose cases where ordering should follow Library order.

In the index harness, complete the Note Index's initial scan with ready layout and a clean cache. Let each test release the Citation Index's layout independently. Capture held reads before their gate opens so an edit can make the pending body stale. The database double uses an in-memory adapter, with editable Citation Key rows for the unseeded case and real query results for seeded cases. Emit the library-availability event independently of scope changes. Share one query client and drive its cooldown through the test clock. [Consumer fixtures](../../packages/citations/src/__fixtures__/citation-index.ts) · [Index harness](../../packages/citations/src/__fixtures__/citation-index/test-harness.ts)

## Citation Index CLI

Version the citation JSON contract independently. Return Citation Index facts and keep rendered presentation in the sidebars. For an ambiguous Citation Key, return candidate Indexed Keys and local Library IDs so the caller can select one Item explicitly. Full Item data stays with `zotlit:template-data`. Report selected source and vault identity once known. An invalid selector can fail before the handler has either fact. Use the caller's expected source to stop a read from the wrong Zotero source. Accept either selector for `zotlit:cited-by` and enforce exactly one in the handler. For `zotlit:references`, accept any Markdown note path, including one that is not a Literature Note. Check existence after the index settles. [CLI request parser](../../packages/citations/src/obsidian/citation-index/cli/request.ts)

Report citing groups in vault path order and reference entries in first-occurrence order. Use the same captured records for membership, syntax inclusion, and coverage. Report an omitted syntax only when the requested result contained occurrences of that excluded syntax. Keep database read failure distinct from a missing Item, and use the resolution state to indicate whether a missing Citation Key result is current. Share the Item summary format and return null when the source cannot provide a summary or the Item has no work of its own.

Convert line and column numbers to one-based values at the JSON boundary. Columns count UTF-16 code units, while `rg --column` counts bytes. Leave the zero-based UTF-16 offset and exclusive end in place so subtracting the offsets gives the source span length. The scanner, Citation Index, and sidebars keep Obsidian's zero-based positions. [JSON envelope](../../packages/citations/src/obsidian/citation-index/cli/envelope.ts)

Use stable diagnostic codes for scripts, English messages for the transcript, and a hint for the caller's recovery step. Define default hints in the code registry and allow parameter errors to supply specific recovery text. Follow the CLI text policy for command and flag descriptions. Serve the same plain-text guide for every caller and reject parameters to expose mistaken calls. Type the guide's registries against the wire values so an added selector, state, or entry kind needs a guide entry. Wrap descriptions in the second column and put longer labels on their own line. [Citations Guide](../../packages/citations/src/obsidian/citation-index/cli/guide.ts) · [CLI text policy](../../apps/obsidian/policies/cli-text.md)

Test complete answers against the real Citation Index with an in-process parse client and an in-memory Zotero database. Hold the edited note's parse reply until after the command starts, then release it and check that the result includes the new occurrences. [Complete-read tests](../../packages/citations/src/obsidian/citation-index/cli/complete-read.test.ts)

## Built-in export bibliography

Use Better BibTeX when its readiness probe succeeds so the export retains its Citation Keys and Extra overrides. Otherwise use Zotero's local API if the server responded and that API is enabled. Both sources use the active profile's server, so connection failure or timeout stops the export. Report a transient port separately when the profile cannot supply it. Bound each request to 30 seconds because Zotero can leave CSL JSON pending while Better BibTeX starts. Return a structured failure for the export UI to explain.

Resolve Better BibTeX item addresses as library ID plus Item key and export one Better CSL JSON batch per Library. Index the reply by Library and Citation Key, since different Libraries can have the same key. Inspect the RPC reply for an error even on HTTP 200. For the local API, read the personal or group route once per Library. Both paths parse CSL JSON and re-index by Indexed Key. The local API can return an Item URI as its CSL ID when it has no Citation Key. Keep the source's ID and refuse a missing requested Item instead of sending an incomplete bibliography to citeproc. [Bibliography lookup](../../packages/citations/src/desktop/pandoc/bibliography.ts)

## Export citation identity

Use the worker's Markdown scan for membership and the source note path for link resolution. Export keeps its own Literature Note membership rules. Resolve literal Citation Keys against the same Library Scope lookup as Live Preview so an ambiguous or missing key stops the export before citeproc. Borrow the requested Citation Locale when supplied and otherwise use the style's locale.

Give each linked Item an Injected ID starting with `#`, which cannot be the start of a literal Citation Key. Use the first literal spelling for an Item when present and its CSL source ID otherwise. Rewrite the prepared document and bibliography together so links and literal citations of the same Item share one entry. Use the Items' Library addresses to fetch their bibliography data. Check coverage against the prepared document before rendering. The current check can accept duplicate render IDs for different Items. [Export implementation](../../packages/citations/src/desktop/pandoc/export.ts) · [Issue 159](https://github.com/aidenlx/zotlit-repo/issues/159)

Keep the outer Citation when its affix contains a nested Citation. Render the nested citation as text and include its work through `nocite`. A wildcard names no individual work. When the sandbox reparses Markdown containing a literal key, keep the same body separator handling and use the unmarked source to assign heading IDs.

Use the in-process parser in export tests. The engine fixture can supply precise prepared citation IDs or refuse conversion, and lookup failures represent unavailable database reads. Test a source that reports an Item URI so rewriting to the author's Citation Key is observable. Include an Indexed Key that matches another Item's literal Citation Key to verify both identities stay distinct. Exercise the actual HTML and DOCX writers with the pinned Pandoc binary. Collapse HTML whitespace before comparing text, check the DOCX ZIP header, and join XML runs when inspecting Word paragraph text. Include callouts adjacent to preceding prose, a declared document language, and an explicit bibliography heading. [Export tests](../../packages/citations/src/desktop/pandoc/export.test.ts)

## Installed CSL styles

Key styles by their declared CSL ID. Display that ID when the title is absent so the picker need not expose a local filename. Visible styles shadow hidden copies with the same ID. Hidden files supply independent parents and stay out of the picker. Keep a missing selection visible until the researcher changes it. Use the empty picker value for the embedded default.

A dependent style names its independent parent and can supply a default locale. Use the requested locale, dependent locale, or independent locale in that order. Preserve requested and parent IDs for repair diagnostics. Distinguish a missing selection, a missing parent, an unreadable file, and invalid style content. A bibliography with second-field alignment supplies the Entry Marker.

Allow namespaced element prefixes in discovery and preserve the original root spelling when setting a locale. Keep `style-options` distinct from `style`. Decode predefined XML entities in IDs, titles, and parent references. Escape markup when writing the locale attribute. Check the XML parse result before handing content to citeproc. Standalone rendering elements require a layout. The current structural check accepts a partial layout, and parent attribute parsing can truncate a valid quoted value. [Style parser](../../packages/citations/src/core/pandoc/csl-style.ts) · [CSL layout](https://docs.citationstyles.org/en/v1.0.2/specification.html#layout) · [XML qualified names](https://www.w3.org/TR/2009/REC-xml-names-20091208/#ns-qualnames) · [Issue 156](https://github.com/aidenlx/zotlit-repo/issues/156)

Read the Zotero data directory's `styles/` and `styles/hidden/` folders. An absent folder contributes no entries. List dialogs retain readable results if a directory refuses listing, while the strict list reports that failure to its caller. Skip files that cannot be read or that declare no style ID. If resolution misses while a folder or file was unreadable, report the access problem because it could hide the requested style or parent. Validate the dependent document's own XML before using its parent's formatting. Reject a parent that is itself dependent. [Zotero style discovery](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/style.js#L94-L155) · [Installed style resolver](../../packages/citations/src/desktop/pandoc/styles.ts)

Share installed style resolution between in-app rendering and export so dependent styles use the same parent and locale. Hold one successful resolution to avoid scanning every installed file on repeat renders. Recheck the exact contents of the requested and parent files so edits under an unchanged modification time are visible. Keep Default and misses outside the cache. The cache follows Zotero's style install and update order, as the 2026-11-23 amendment states. [Issue 157](https://github.com/aidenlx/zotlit-repo/issues/157)

Populate a dialog's picker immediately, then add the installed styles when discovery finishes. Retain the current selection, including changes made while discovery was running. Let callers keep unavailable choices visible as disabled entries. The style tests cover same-timestamp edits, read failures before and after discovery, and malformed dependent documents. The citeproc integration fixture prints a marker and an issue month to distinguish style and locale, and uses two authors to verify the locale of the embedded style. Its timeout includes Haskell startup. [Style picker](../../packages/citations/src/desktop/pandoc/style-dropdown.ts) · [Resolver tests](../../packages/citations/src/desktop/pandoc/styles.test.ts) · [citeproc tests](../../packages/citations/src/desktop/pandoc/styles.integration.test.ts)

## Citation settings

Select one hover action per surface. Off leaves hover to Obsidian. By default, Source mode requires held Mod so plain-text editing can proceed without the popover. Rendered modes accept bare hover. Citation navigation applies to both Pandoc Citations and Literature Note wikilinks rendered as Citations. Rendering an Annotation Citation in place requires both Annotation Citations and formatted citation display.

Show Require Mod controls only for the Citation Popover and use one destination row for each hover surface. Put the shared requirement in the subpage description. Read the Graph core plugin state each time the settings page opens so the description can explain when Graph Citations has no visible effect. Query views fill the suggestions slot with the Annotation trigger, Notes fills the Citation Text slot, and desktop Citations fills the final native Pandoc slot. [Citation settings page](../../packages/citations/src/obsidian/citation-index/settings-page.ts)

Use `[>` for the default Annotation Suggester trigger, with a bracket to match the Citation Suggester and a greater-than sign for the quote. An empty trigger disables it. A conflicting Citation trigger does not open the Annotation Suggester.

Leave the CSL style's default in charge for a null or empty Citation Locale. Locale tests accept language extensions, private-use tags, and irregular tags irrespective of case. Keep the collation extension for bibliography sorting, and refuse duplicate variants or extension singletons. [Citation settings](../../packages/citations/src/core/citation-index/settings.ts) · [Locale tests](../../packages/citations/src/core/citation-index/settings.test.ts)

## Citation Presentation and export dialogs

Expose Citation Presentation from the command palette and the active Markdown note's More options menu. Edit the note's style and Document Language in one confirmation. Show the declared choices and inherited vault values on entry, with the Default Profile supplying the vault style. The language reset's tooltip explains that clearing the field removes the property and restores the vault Citation Locale. Reject an invalid language in the field. Let a confirmed settings write and its notice finish on unload. [Citation Presentation dialog](../../packages/citations/src/desktop/citation-presentation/modal.ts) · [Action registration](../../packages/citations/src/desktop/citation-presentation/register.ts)

Write the confirmed properties together through the live frontmatter boundary. Delete a property to inherit the vault selection. The repair dialog accepts malformed existing properties as input and lets the researcher correct them. Show an unavailable style as the current selection with a disabled picker entry, so selecting a different style is an explicit act. [Citation Presentation properties](../../packages/citations/src/obsidian/citation-presentation/presentation.ts)

Start built-in export with the same effective presentation used in Obsidian. A malformed note property stops preflight. A missing installed style stays visible in the picker so the researcher can choose another for this export. Apply the choice only to the run. Refuse an unavailable selection on confirmation. Apply the effective Citation Locale through CSL and preserve the note's own language metadata in the output. Offer an engine settings action when the WASM engine is unavailable.

Offer HTML and DOCX, which the WASM engine can write directly. Keep the chosen path as a stem with the known note or export extension removed. Append the selected format's extension so changing formats cannot leave an obsolete extension. Display a vault-relative or home-relative path where available, and keep the absolute path for the system picker and write. Keep the actual cause when conversion fails and report a destination write failure separately. [Export dialog](../../packages/citations/src/desktop/pandoc-export/modal.ts) · [Export command](../../packages/citations/src/desktop/pandoc-export/register.ts)

## Document presentation precedence

An Imported Note takes its style from its Profile. Other documents use an explicit style property or inherit the vault style when that property is absent. The Default Profile supplies the vault style. A present malformed value stops presentation and identifies the property to repair. Document Language is document-wide for every note kind. An empty vault Citation Locale leaves the style's default locale in charge. Notes supplies the Profile port. Synchronous readers run that port through their existing Effect context and retain the original failure.

Use the same effective style, locale, and ordered cited works for Document Citation Text, References Sidebar, and Citation Popover. This keeps numbering consistent. Omit a Citation with no readable work, and represent a stopped presentation by its repair diagnostic so a different repair changes the result. [Presentation precedence](../../packages/citations/src/obsidian/pandoc/document-presentation.ts)

Watch render-cache state for a missing-style notice through a lifecycle subscription so rendering does not need to show it. The notice offers the style settings. On each change of the missing style, the watcher hides the notice it owns and shows a new one only while a style is missing, so a repair also hides it. This was fixed on 2026-11-23 in [PR 245](https://github.com/aidenlx/zotlit-repo/pull/245). [Style notice](../../packages/citations/src/obsidian/pandoc/notices.ts) · [Issue 160](https://github.com/aidenlx/zotlit-repo/issues/160)

## Shared editor and reading helpers

Use the native Live Preview field and reveal raw text when a selection touches
either endpoint of the decoration. A blurred editor supplies no active
selection for reveal. Dispatch editor refreshes independently of text edits
when external citation or link data changes. Scan visible ranges in document
order, widening to whole lines and merging overlapping ranges so a token
cannot be split or emitted twice. Use the parser's token classes and omit
line wrappers so they do not interrupt adjacent tokens. [Editor helpers](../../packages/obsidian-kit/src/editor-decoration.ts)

Refresh visible reading sections when display data changes. Rerender the
view when the set of rendered links can change. Attach each section to an
Obsidian render child, remove it when the child unloads, and reuse the child
when replacing that section's refresh action. Retire a surface before its
last rerender so the still-registered post-processor leaves no output.
Use the source section's full line range to distinguish equal Citation
Occurrences in different parts of a note. An embed or popover can have no
source range. A draft preview keeps the native link path and supplies its own
citation data. [Reading section helpers](../../packages/obsidian-kit/src/reading-view.ts) · [Reading surface lifecycle](../../packages/obsidian-kit/src/reading-surface.ts)

The plugin externalizes CodeMirror and reads Obsidian's fork-only token and
line class properties at runtime. The Markdown stream parser attaches
space-separated classes to token nodes and to a separate node spanning each
line. This is the property shape declared by
[the pinned CodeMirror fork](https://github.com/lishid/cm-language/blob/b817e72a9861b3f8a50a92a2ea53cbafc4f88eb3/src/stream-parser.ts#L454-L455).
[Local declarations](../../packages/obsidian-kit/src/typings/codemirror-ex.d.ts)

Use Obsidian's highlight spans and an accent color in Item suggestions.
The CSS custom property controls the title text window, with a 60-character
fallback before styling is available. Keep roughly one third of that window
before the first match and shift the window back if it reaches the end.
Show the Library flair only when several libraries can supply results, and
leave the implicit My Library unlabelled. Use a trailing flair in a wide
row and a baseline-aligned badge below the title in a narrow row so the
title keeps enough width. Draw the flair with plugin utilities because the
native unlayered auxiliary slot resists hiding. Preserve the publication
class for themes and use the same Author Summary, Venue, and locator slot
for every Item type. [Item suggestion row](../../packages/plugin-services/src/obsidian/item-lookup/render-hit.ts)

### Annotation Citation display proof

Use a Durable Annotation Link with no label to check Annotation Citation
display. Before the citation read finishes, or when citation rendering
is off, the link keeps its native form. Once rendered, the citation uses
the parent Item with the Annotation's page as locator. Check the hover
in both modes because it combines the Annotation and Item reference.
In Live Preview, find Obsidian's empty-label link token. Restore the
note and settings when the check ends.

[Annotation Citation End-to-end Run](../../packages/e2e/src/annotation-citations.e2e.ts)

### Annotation Suggester and hover proof

The Annotation Suggester searches with Zotero closed. Its trigger,
quoted word, and narrowing token use the Library View grammar.
Choosing a row replaces the query with the Annotation template
output and records a Use. A note Annotation uses its comment.
Render Zotero's rich text subset in both the hover and suggestion
row. Rewrite the Fixture text, refresh the repository, and choose by
the rewritten text so a stale index cannot pass. Restore the text
before refreshing again. The one-line template includes a braced
Pandoc page locator and the Durable Annotation Link. A trigger
directly after a word does not insert a leading space.

For an absent hover, use a later control hover in a split with the
same opening delay. Re-enable the Hover Action for the control after
the first mouseover has decided its behavior. When a hover opens,
wait for the Annotation or its unavailable state because the
reference can appear first. Source mode draws separate text and URL
spans. Hovering across them keeps a single popover anchored to the
whole link. Wait past the opening delay to check that placement.
A hover can render the Excerpt Image without a PDF reader open.
Check Obsidian's Page Preview Mod setting in both states. Pandoc
rendering and the click destination are independent of the hover.
A missing Attachment or missing Annotation yields unavailable.

[Annotation Suggester and hover cases](../../packages/e2e/src/annotation-links.e2e.ts)

In the Paired Run, wait for Better BibTeX to register its
endpoint and for ZotLit to read the profile's add-on list.
An earlier readiness check can run export while Zotero is
still starting and take the fallback route.

[Paired export case](../../packages/e2e/src/paired-local-api.e2e.ts)

The desktop hover case waits for formatted citation output. Hover
each distinct element once so the test does not restart its opening
delay. A redraw invalidates that hover and allows the replacement
element to be hovered. A popover closing over the same element fails
the case. A separate navigation probe records the open request
while returning a harmless Effect, so the probe does not open a note.

Keep the References toolbar fixed and scroll the banners with the list.
Lead with a note-specific property repair before vault-wide engine
guidance. The pack offer is dismissible across References panes until
plugin reload. Keep a separate formatting failure when the engine is
available. Give actions room to line-wrap under sidebar banner text.
Preserve the toolbar and Jump on an unresolved entry because the note
can still be repaired. Omit an unavailable external target and keep
Open in Zotero. The registry can release an unobserved node immediately
after its last reader leaves.

The Obsidian Feature supplies portable parsing, indexing, citation
text, editing, Graph Citations, the engine and settings. The desktop
Feature adds bibliography rendering, popovers, References, export, and
Citation Presentation. Preserve view registration order so Cited By
follows References.

## Amendment (2026-11-23): the style cache follows Zotero's install order

A held style resolution rechecks the exact contents of the files it selected. Zotero's style install, its bundled-style update and its repository update remove the existing file for a style ID before they write the replacement. The held read then fails and the cache refreshes. [Zotero style install](https://github.com/zotero/zotero/blob/4a8a88dd41222dbb955c5d34663623c0c63e4fda/chrome/content/zotero/xpcom/style.js) · [Zotero style updates](https://github.com/zotero/zotero/blob/4a8a88dd41222dbb955c5d34663623c0c63e4fda/chrome/content/zotero/xpcom/schema.js)

Accepted limit: a `.csl` file copied by hand into `styles/`, while the hidden copy with the same ID stays, leaves the hidden parent in use until the plugin reloads.

ZotLit writes no style files, and no other path to this state was found, so the resolver keeps its behavior.

The maintainer closed the issue with no change on 2026-11-23. [Issue 157](https://github.com/aidenlx/zotlit-repo/issues/157)

## Amendment (2026-11-23): citation presentation follows state changes

- **Search reveal.** In Live Preview, an Obsidian search highlight that touches a Wikilink Citation reveals its source, as a selection does, also while the editor is blurred. The decoration reads the highlight ranges from the static decoration sets in `EditorView.decorations` whose mark class is `obsidian-search-match-highlight`. A desktop check in Obsidian 1.15.1 confirmed that the brackets and the match show while the search is open and that the formatted citation returns when it closes.
- **Profile diagnostic.** The citekey and wikilink Reading views keep the Imported Note Profile diagnostic on the retained element and refresh it with that element.
- **Popover attachments.** A failed attachment read gives `"unreadable"`, and a successful read with no attachments gives an empty list. A click on the attachment button keeps the Citation Popover open in both cases. For an empty list the button goes away. For an unreadable list the button stays and a notice reports that ZotLit could not read the attachments from Zotero.
- **Annotation links.** When a fresh settled result no longer formats an occurrence, the Reading view unmounts its rendered citation and restores the native link.

Accepted limits:

- The search reveal depends on two parts of Obsidian outside its public API: the class name `obsidian-search-match-highlight` and the publication of the highlight field as a static set in `EditorView.decorations`. A function source in that facet is not read. Check both after an Obsidian update.
- The annotation link restore calls `createRoot(anchor).unmount()` on a new root. This removes the rendered citation only under preact/compat, which the plugin build's Preact preset puts in place of `react-dom`.
- A refresh with no Citation Text result keeps the previous diagnostic.
- The References Sidebar shows an unreadable attachment list as no attachments, with no Open attachment button.

[Issue 162](https://github.com/aidenlx/zotlit-repo/issues/162) · [Issue 164](https://github.com/aidenlx/zotlit-repo/issues/164) · [Issue 165](https://github.com/aidenlx/zotlit-repo/issues/165) · [Issue 166](https://github.com/aidenlx/zotlit-repo/issues/166) · [PR 245](https://github.com/aidenlx/zotlit-repo/pull/245)

## Amendment (2026-11-23): Reading view citations return to source text

The citekey, Wikilink, and Annotation Citation Reading views use one rule when they rewrite a held section:

- A fresh settled Citation Text result with formatted text for a citation shows that text.
- A fresh settled result with no formatted text for a citation restores its source presentation. This occurs, for example, when the note's Imported Note Profile is unavailable. A citekey citation shows its source text in an element equal to the one that a first render gives in that state, with its key state and Profile diagnostic. A Wikilink Citation Run gets back its native anchors and separators. An Annotation link gets back its native link.
- A revalidating or failed read keeps the current text, as the Held Read rule of ADR 0054 states.
- When there is no Citation Text result, the citation keeps its current text and diagnostic. This is the accepted limit "A refresh with no Citation Text result keeps the previous diagnostic" above.

Before this change the citekey Reading view kept the last formatted text for a fresh result with no text. That behaviour came from the in-place refresh of 2026-09-06, which applied the Held Read rule to every result. The Held Read rule covers only revalidating and failed reads, so a fresh result now restores the source text. A researcher who switches to a Profile that cannot format the citation then sees the citekey source and the Profile diagnostic, as with a Wikilink Citation.

The three views apply the same status check. The steps that restore the presentation are different for each view: the citekey view builds its element from the source text again, and the other two views restore the native anchors that Obsidian rendered.

[Issue 238](https://github.com/aidenlx/zotlit-repo/issues/238) · [Issue 258](https://github.com/aidenlx/zotlit-repo/issues/258) · [PR 260](https://github.com/aidenlx/zotlit-repo/pull/260)
