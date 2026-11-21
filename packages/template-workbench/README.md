# The Workbench core

The host-free units under `src/core/` that the Template Workbench View, the
Template Data Explorer and the Query View build on: `document`, `data-tree`,
`language`, `filter-fields`, `render`, and the headless UI `headless-ui`
(`AGENTS.md` lists them). Only `headless-ui` reads React, which the plugin
bundles as Preact. The units target CodeMirror at the versions Obsidian pins.

What the plugin's other packages share with the Workbench lives with its
owner, and the Workbench core imports it from there:

- the Item Snapshot — its shape in `@zotlit/zotero-reads/contract/snapshot/`,
  its export in `@zotlit/zotero-reads/worker/snapshot/export.ts`, which the
  ItemSnapshot RPC answers with;
- the Template data helpers — accessor paths, the inert-helper mark, and
  `serializeTemplateData` — in `@zotlit/db/template-data`;
- the render diagnostics and reports, the render failure readers, and the
  side-effect-free note resolvers in `@zotlit/notes/core/template/`, and the
  Sample Items, Sample Annotations, Citation examples and Shared Partial
  preview contexts in `@zotlit/notes/core/template-preview/`, which a refused
  note operation and the template data service read too;
- `observeExit` and `joinForked` in `@zotlit/plugin-kernel/fiber-exit.ts`, and
  the Signature Hint class in the plugin's theme hooks.

The core carries no logger: it names every decision a host acts on in the value it
returns — a `WorkbenchProblem`, a `RenderDiagnostic` — so the host logs. That is a scoped exception to
[the logging policy](../../policies/logging.md).

## Document

`document/` owns one Profile document and its editing rules.
The complete source is the authority ([ADR 0032](../../docs/adr/0032-web-workbench-edits-one-source-document.md)):

- `WorkbenchDocumentController` — a headless master `EditorState` holding the
  only undo history. It re-derives the slice ranges and the Problems list from
  the source after every change, keeps a draft that does not parse editable, and
  quarantines the focused slice from an edit computed elsewhere. It reads and
  writes the line break the document arrived with.
- `workbenchSlice(controller, id)` — the editor extension for one pane, in the
  shape Obsidian uses for Live Preview table cells: its own state over its own
  small document, no history of its own, an echo-guard annotation across the
  boundary, the child's user event forwarded so keystrokes group into one undo
  step, undo and redo routed to the master, and a wholesale child refresh.
  The editor shows its slice through the controller's `sliceCodec(id)`:
  initialize its text with `sliceShownText(controller, id)` and map carets with
  `sliceOffsets(controller, id, shown)`. A manifest scalar — the note name and a
  Liquid property rule — shows the text YAML reads, and every edit stores a
  YAML spelling that reads back as exactly the reader's text. A JSON-e property
  shows two-space indentation and stores compact JSON in YAML; its draft layout
  and selections, including whitespace-only edits, use master history effects.
  Token spelling and string contents remain unchanged.
- `manifestValueEdit(source, path, value)` — the one targeted YAML patch, so a
  form control changes a single manifest node and every other byte survives.
- `manifestKeyEdit(source, key, value)` and the controller's `setManifestKey` —
  one top-level manifest key written, or removed with its own line when the
  value is `undefined`. They are the two halves of Override and Use default, so
  an explicit empty path, a null style, and a `false` toggle each stay distinct
  from an unset key; a key the manifest never wrote lands at its foot. Each call
  is one undo step.
- `manifestNodeRange(source, path)` — the source range one manifest node covers,
  so a host can tell which manifest value an editor position sits in.
- `manifestScalarSlice(source, path)` — the region a pane edits a manifest
  scalar through, so the note-name template is edited as template source. A
  block scalar's one content line is `literal`, which YAML holds as written;
  any other scalar is the whole scalar, quotes included, which the pane shows
  through the scalar codec. It answers null for a value that is not a scalar or
  one of several lines, which leaves that value to Advanced. The
  controller keeps it as the `filename` slice and reports it through
  `filenameSlice`.
- `managedFrontmatterEntries(source)` — every Managed Frontmatter entry the
  manifest authors, with its key, language, merge strategy, the whole lines it
  occupies, and the expression a row edits. It answers `rows` with those
  entries, `source-only` when the manifest parses and its list is written in a
  shape a form cannot patch — a flow list, or an entry that is not a block
  mapping — which leaves that list to Advanced, and `unparsed` while the
  manifest itself does not parse.
- `managedEntryEdit(source, action)` and the controller's `editManagedEntry` —
  the one place a Properties action becomes source bytes: add a property, add a
  Spread Entry, add an override after an entry, remove, reorder, change the
  language, or set the key or merge strategy. Each is one undo step, rewrites
  only the lines of the entry it names, and starts a new expression on a
  language change rather than translating the old one.
- `noteRegions(source, note)` — the boxes the note body carries, in the offsets
  the source is read in: every annotation render call, in the shortcut form and
  in the native `render "annotation"` form, and the Managed Block with its
  line-owning tags apart from the tag text. A call inside a Liquid `raw` or
  `comment` block, or inside a Markdown code fence or code span, is prose about
  a call rather than a call, so it is left out. The controller keeps the answer
  as `noteRegions`, and a host reads the same function over a pane's own text.
  @see docs/adr/0034-template-rendering-shortcut-is-annotation-specific.md
- `partialCalls(source, region, language)` — every Shared Partial call inside
  one region: a Liquid `render` or `include` tag, or an Eta `include("name", …)`
  call, whose first argument is a plain quoted name, with the name, the
  arguments the call passes after it, and the line it owns. It skips the same
  raw, comment, and code regions `noteRegions` does, and skips the five names
  another ZotLit template already answers to — `filename`, `note`, `annotation`,
  `content`, and `citation` — which no partial can be given. Any pane reads its
  own calls through it — the note body, the Annotation Section, and the one
  editor a plain document opens.
- The controller's `annotationSection` — the Annotation Section's header line
  and the source under it, which is also the `annotation` slice. A draft the
  parser refuses keeps the regions it had, so the reader repairs the text in the
  editor they are in; a document that has never carried a section answers null.
- The controller's `repairAnnotationSection()` — the header a document without
  one is missing, written as a line of its own at the end of the file in one
  undo step. It writes that header and the line break that ends it and nothing
  else, so the section it opens is empty until the reader writes in it.
- `entrySlice(position)` and `entryPosition(id)` — the slice id one entry's
  expression is edited through, and the entry a slice id names. The controller
  re-derives those ranges from the manifest after every change, and keeps the
  last list it parsed while a draft is mid-repair; a list that parses into a
  shape no form can patch takes the rows and their ranges with it, and
  `managedEntries` answers null. A problem carries the pane it is
  repaired in: the row of the entry the parser pinned it to, `filename` for the
  manifest value the note name lives in, `note` for a Managed Block or a stray
  section header inside the note body, and Advanced for the document's own
  structure and for every error no pane can name.

### Limits

An entry whose `value` spans several lines is edited as the source holds it:
the slice carries the continuation lines' own indentation, and a line the
reader adds needs its own indent. A single-line rule — the shape every action
writes — has no such catch.

## UI

`headless-ui/` is the headless component tree the Obsidian host mounts over one
Profile document (ADR 0044). It renders structure and behaviour and no look:
every component marks its parts with `data-part` and their state with
`data-state`, and `WorkbenchThemeProvider` takes one optional class map, keyed
by component and part (`WorkbenchParts` lists them), plus an icon renderer.
Call sites pass no classes. `WorkbenchHostProvider` takes the host adapter —
`menu`, `dialog`, `confirm`, `suggester`, `tooltip`, `notice`,
`render`, `matchData`, `insertTarget`, `persistence`, `messages`, and
`getLocale` — so
Obsidian shows its own `Menu`, `Modal`, `SuggestModal`, and `Notice`. `WorkbenchEditorProvider` carries one editor instance and
puts its atom registry in context (`@effect/atom-react`); `useWorkbenchModel`
and `useWorkbenchController` read it. Components read the model's atoms and
change them with its pure `(state) => state` transitions (`chooseItem`,
`setTab`, `setRoot`, `setAdvanced`, `chooseAnnotation`, `chooseCitation`,
`setPreview`, and `patch` / `patchAt` for the rest). They hold no copy of
model state and fork their work on the model's runtime, so an unmount
interrupts it.

`createWorkbenchEditor({ host, controller, runtime, registry })` builds the
Workbench model with `makeWorkbenchModel` and keeps it mounted in the
registry until the editor is disposed. The model is writable atoms — the view
state (tab, chosen Item, focused root, Advanced, editor presentation) and the
reader's choices (Annotation example, Citation example and Variant, Shared
Partial caller and Profile, preview settings) — beside the document controller
in use, which stays the document authority. `workbenchDocumentAtoms` publishes
the controller's facts as atoms: `source`, `problems`, `slices`,
`managedEntries`, `readOnly`, and a `revision` that counts every update;
`attach` sets the controller in use to one the host loaded. A host that keeps
the view state or the choices in atoms of its own passes `view` and
`choices`, and `itemData` derives the chosen Item's data from the host's one
read of that Item, which every surface reads.

The Render Scheduler is Effect code over the model
(`makeRenderSchedulerAtoms`). Its input is a derived atom: the source, the
Item Snapshot, the selections, and the preview settings. A change to the
input interrupts the 300 ms quiet time (a `sleep` on the runtime's clock) and
any render in flight, then the scheduler forks `host.render`, an Effect for
one request; its failure reads as a `render-error` diagnostic. `run` renders
at once (Run), `pause` lets a render in flight finish and starts no other
(Stop), and On demand renders only on `run`. `hold` in the input holds
rendering while the host cannot answer for the draft; `hold: "invalid"` is the
one hold that is a failure, a document the parser refuses, which reads as
`staleReason: "invalid"`. An optional `mapResult` gives successful and failed
results the host's own result shape. Its `state` atom — `result`,
`retained`, `busy`, `staleReason` — is what every result surface paints, so
the editor and its preview read one render. `retained` is the newest output
each preview surface produced, kept while the document is invalid or `result`
is a failed attempt, and the reader is still on the document, paper, example,
caller, and mode it was rendered for, so a repair reads against working output
rather than an empty pane; a source edit leaves that match intact. A note that
failed beside an annotation that rendered keeps the last note that worked,
because the surfaces are kept apart. Its `trigger` says whether Run or the
quiet time after an edit asked for the shown result, and `attempt` counts the
results it has published, so two attempts over the same bytes stay distinct.
Outside the editor provider the tree paints inert. The components so far:
`TabBar` and `TabPanel`, `EditToolbar` (Basic against Advanced, undo, redo, a
host's own controls as children), and `ProblemsFooter` with `problemText` and
`diagnosticText`, the words for every core code. A Profile edited beside a
vault reports `bundled-partial` for the partials its manifest still carries;
the recovery is a text suggestion like every other one, and the vault host
unpacks them into files with `dropBundledPartials` from its own partial
workflow.

`ProblemsFooter` is the editor's Problems area, and the editor owns detailed
diagnosis (ADR 0056). `workbenchDiagnoses(problems, diagnostics)` folds the
parser's problems and the renderer's diagnostics into one list of
`WorkbenchDiagnosis`, each with an identity built from its code, the object it
names, and the section it was reported under — never from its message text and
never from an offset, which the reader's own typing moves. Occurrences that
share an identity become one problem with several `occurrences`, and
`diagnosisEngineSources` writes out the place each was reported from; equal
words about two objects stay two problems, and a failure with nothing verified
about it — no object named, no call to repair it at — groups with nothing.
`useWorkbenchProblems` holds the reader's selection and their open-or-collapsed
choice: automatic checks leave that choice alone, while `select` — what a
source marker, the area's own selector, and the preview's Show problem call —
and a failed explicit Run open the explanation. The area counts the problems
found, names each one in its selector with `diagnosisLabel`, and reports a
selected problem a repair resolved as resolved, offering `next` rather than
moving the reader to it. `diagnosisExplanation` writes the affected object, a
plain condition, and a text suggestion; repairs stay the reader's own edit.
The preview and the editor read one scheduler, so the Problems area explains
what the preview's render found, and a deliberate Run that failed opens its
explanation at once.

Technical details shows the failed attempt's report, and Copy error report
copies that same text through the host's `copy`; Ask the community links to the
host's `communityUrl` beside it, and both stay reachable while the disclosure
is collapsed. A clipboard that refuses opens the disclosure and says the copy
failed, leaving the text to select by hand. `diagnosisReport` reads the report
one diagnosis carries; `useWorkbenchProblems` keeps the last one read, so an
open area whose problems are all resolved still offers Copy last error report.

The area states how much editor it is taking — `compact`, `open`, or `full` —
and the hosts size each from CSS, so a pane too short or too narrow for the
split reaches the same full-editor reading with no measurement here. `Expand`
asks for the whole editor; `Return to template` gives the space back and calls
the host's `onReturn`, which puts the caret back where the reader left it. The
explanation scrolls inside the area and the controls sit under that scroll, so
a long explanation and an open disclosure leave every one of them in place.

`usePartialBoxes(controller, slice, host)` draws the Partial Placeholder over
every Shared Partial call in one pane: the editor extension to pass that pane
and the boxes to render beside it. The host answers the names the last render
could not resolve, opening a partial, reading one's problem, and rendering one
for the caller that pane's slice supplies — a missing partial is the engine's
own render failure, never a scan, so the box's short Missing marker appears
only for a name a render reported, and selects that problem in the editor's
Problems area.

The host supplies `messages` and `getLocale` through `WorkbenchHostProvider`.
Obsidian passes its Language Pack facade. Components read
`useWorkbenchMessages()`, and pure text helpers take the message functions as
an argument. A host without overlays can use `WorkbenchMessagesProvider`
directly.

`pnpm generate:message-types` reads the root `workbench_*` catalog through the
existing message compiler and emits the `WorkbenchMessages` type contract.
The English pack it emits is used only by the core's tests. Turbo runs generation
before `test`, `typecheck`, and `typecheck:test` here and in each package whose
type check reads the contract; direct package-tool runs need those generated files first. The tree stays inside the
`preact/compat` surface, and its suite under `src/core/headless-ui/` runs in the `ui` Vitest
project with React aliased to `preact/compat` and Testing Library to its Preact
build, as Obsidian runs it.

## Render

`engineEvidence(error)` takes the engine's own account — message, name, stack,
the chain behind it, a caret excerpt, and the location the engine named — at
the boundary that catches a failure, before a diagnostic reduces it to one
message. The scheduler pairs it with that attempt through `captureRenderReport`
and hands the result's diagnostics a `report`; `formatRenderReport` is the one
serializer, so displayed and copied text are the same string. Its labels and
its `unavailable` marker stay English: a report travels to an issue or the
community, where one format keeps reports comparable. A scheduler's
`reportContext` names the Template Document, language, rendering root, Item,
and versions that only its host knows.

`render/` renders a Profile against an Item Snapshot; the Render Scheduler
that decides when lives in `headless-ui/`:

- `renderProfile(source, snapshot, options)` — the result set with diagnostics,
  stamped with the source, snapshot, and selected annotation revisions. Options
  carry an independent annotation example as its
  serialized root and matching descriptors. Its parent Item supplies its citation;
  the note keeps rendering against its own snapshot. Every Managed Frontmatter
  entry evaluates on its own against that one snapshot, so `properties` carries
  each entry's own result under the 1-based position that produced it, `fold`
  carries the frontmatter the note gets once every entry has merged, and a
  property diagnostic — an evaluation failure, a `js` entry, or an append the
  fold could not take — names the entry responsible for it.
- `SAMPLE_ANNOTATIONS` — six built-in annotation examples covering highlight,
  underline, note, text, image, and ink, with comments, tags, and empty optional
  fields. Each example carries the matching descriptors needed to restore it.

A `RenderDiagnostic` and a `WorkbenchProblem` name what went wrong by `code`,
with the values that fill it in `params`. The core reads no Language Pack
facade, so the host writes each code in the reader's own language. `message`
carries the wording the core did not author: the template engine's failure
text, the host's own, and the document parser's.

`render/index.ts` re-exports the diagnostics, reports and examples above.
`renderFailureDiagnostic(error, caller)` reads one thrown render failure
against the source that render read and keeps its three answers apart:
`engine` is where the engine itself said it happened, `caller` the document a
failure named as holding the call, and `callSite` the call in that source which
reached the failing template — the one verified repair location. Each is set
only on its own evidence, so a name the source never spells leaves `callSite`
absent and the host says the location is unverified rather than sending the
reader to a guessed line. `templateCalls` in `document/` is
the scan behind it, and reads the reserved names `partialCalls` drops; the
notes' own reader takes that scan as a parameter and finds no call without it.
`renderFailureCause(error)` reads the same evidence as the cause alone — the
template the engine could not resolve, or the place it stopped in the one it
named — so a render path that tries one document part after another reports
one fault once without comparing either failure's wording.

## Language

`language/` holds the editor support for Liquid, Eta, and JSON-e
authoring:

- `liquidTemplate` — the upstream Liquid language over plain text.
- `templateHighlighting` and `templateToken` — the `zt-template-*` classes every
  editor emits per token kind; a host colors them.
- `jsonRule` and `embeddedJsonE` — JSON parsing and JSON-e expression token colors
  in Property rules and Advanced, using the same source regions as completion.
- `liquidRanges(source)` — a quote-aware delimiter scanner that bounds
  suggestions and hover and marks the Managed Block tags as `structural`.
- `eta`, `etaLanguage`, `etaRange(source, position)` — a Lezer grammar for
  Eta v4 default tags with JavaScript mounted inside each tag body, plus the
  auto-pair extension `etaAutoPair()`.
- `suggestions(source, position, config)` and `hoverHint(...)` — contract-driven
  field, filter, tag, partial, and snippet options; `rootAt(...)` resolves the
  root in scope at a position.
- `templateCompletion(read, presentation?)` — the optional CodeMirror typing popup adapter; a host passes the classes and extra cells its rows wear, and reads each row's `completionSuggestion(completion)` to draw them.
  `read()` answers with the pane's current root, partials, and Item values.
- `language/semantics.ts` exports the editor-independent `hoverHint(...)`
  resolver: the source range and property facts, including type, description,
  and sample. Hosts own hover timing, geometry, presentation, and dismissal.
  A native Obsidian adapter can render those facts through `HoverPopover`;
  see the [native hover research](../../docs/research/obsidian-editor-hover.md).

Regenerate the Eta parser after editing `src/core/language/eta.grammar`:

```sh
pnpm --filter @zotlit/template-workbench generate:eta
```

JSON-e rules use `jsonc-parser` for incomplete JSON and source ranges. The shared
resolver handles operator keys, functions, contract paths, bracket members, and
statically traceable locals. Each rule has its own scope. The JSON-e runtime is
the semantic-validation authority; the editor does not execute drafts to infer
local values. JSON syntax errors appear in the document Problems list.

Hosts supply the syntax colors: the Liquid delimiter class above and the Eta
delimiter class `zt-eta-delimiter`.

### Limits

Recorded from the prototype review; these affect editing, not rendering.

- The upstream Liquid grammar has no output whitespace-control (`{{-`, `-}}`)
  syntax, no filter-token colors, and no custom end-tag names, so
  `{% endmanaged %}` and `{% endbq %}` parse as error nodes.
  The delimiter accent also colors literal delimiters inside strings and raw
  blocks.
- Inside a multiline `{% liquid %}` block, filter completion works; tag-name and
  partial-name completion there are not covered.
- The Eta grammar covers Eta v4 default tags, not EJS. The close delimiter ends
  the tag body even inside a JavaScript string, template literal, or comment,
  where the engine keeps scanning. Whitespace between a trim marker and the
  output prefix (`<% = x %>`) is not recognized as a prefixed tag.
- A JavaScript block split across Eta tags produces editor recovery nodes while
  the engine renders the complete program.
- Loop-variable inference, JavaScript local-variable scope, bracket-path
  completion (`zt["title"]`), and screen reader and IME audits are outside the
  port.
- [ADR 0035](../../docs/adr/0035-profile-annotation-section.md) replaced the
  earlier rule that gave both `annotation` and `managed` a paired-tag
  completion. The Annotation Section now starts at the `ANNOTATION_HEADER`
  line, so only `managed` completes as a paired block.
