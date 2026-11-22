---
status: accepted
---

# Template diagnosis belongs to the editor

> Amended 2026-09-14: the note name is a preview surface of its own. Both
> renderers produce it first, in its own guarded step ahead of the note body,
> so a mistake in the Filename Template leaves the body, the Managed
> Frontmatter results, and the Managed Region on screen, and a mistake
> anywhere else leaves the last note name that worked standing. The render
> diagnostic's part names it, and that part outranks the captured rendering
> root when the explanation names the object: the part is evidence from the
> renderer, while the root only records which data the reader had open. A
> surface that produced nothing and a diagnostic naming it is what a preview
> reads as this surface's failure, in place of one diagnostic code.

> Amended 2026-09-13: a repair location is verified by one rule — the source
> this render read holds a call naming the template the engine blamed, or the
> partial it could not resolve. That call is the repair target and outranks the
> part the failure was reported under, because a failure inside a called
> template is repaired where it was called. A template the engine never
> resolved gets no reported location at all, since nothing was read there, and
> a caller is recorded only when the failure names a document path rather than
> a placeholder reference. Everything else leaves the repair location absent
> and says so. A source that spells the blamed template at several calls
> reached it from one of them and names which nowhere, so the location stays
> absent there too; a partial the engine could not resolve is the exception,
> because every call naming it is broken by the same missing document and the
> first is as good a repair target as any.

> Amended 2026-09-13: the report's own labels and its `unavailable` marker are
> English, whatever language the explanation above them is read in. A report is
> written to be pasted into an issue or the community, where one format keeps
> reports comparable and the engine's own words are untranslated anyway. The
> explanation, the disclosure label, and the reporting controls stay localized.

> Amended 2026-09-13: the Problems area performs no repair at all. Unpack
> partials, its one remaining host control, is an ordinary partial operation —
> it writes partial files — and the editor already offers every other one from
> its Partials menu, beside the vault's partials and New partial. That is where
> it lives now, offered only while the open document still carries bundled
> partials, and the `bundled-partial` problem names the route in its own
> suggestion. Every diagnosis keeps text suggestions alone.

> Amended 2026-09-13: the scheduler's hold carried two conditions under one
> sentence — a document the parser refuses, and a preview that is paused or
> cannot render yet. They are separate inputs now. A document that does not
> parse is a failure: it takes the retained-preview sentence and offers Show
> problem, the same as a render that failed. Every other hold keeps its
> established wording, as do the on-demand wait and the pending live check.
> One sentence over both causes was the wrong-cause failure the design guide
> names.

> Amended 2026-09-13: an open Problems area takes a settled share of the
> editor pane rather than the height of whatever it explains. Holding a
> measured height after a repair was the same intent written in JavaScript; a
> share the pane resolves in CSS holds through every content change, the
> reader's move between problems included, and leaves the source exactly where
> it stands. Expand and a pane with no room left for the split both give the
> explanation the whole pane, and the source keeps a flexible height so it
> gives that height up and comes back with it. Return to template is the
> reading's exit rather than a step back through the sizes: it reclaims the
> area and puts the caret back where the reader left it, which is the same
> answer in a pane that had room for the split and one that never did.

> Amended 2026-09-13: the selected problem is held from the moment the area is
> open, whether the reader chose it or read whichever came first, and it is
> let go once a check finds nothing at all — and once the reader reclaims the
> area, because nothing is being read there from then on. A compact area
> follows the first problem found; an open one does not, because a check would
> otherwise change the explanation under the reader. A
> check that finds nothing ends the reading, so the next failure arrives as
> the problem it is rather than as a resolved state with Next problem.

> Amended 2026-09-13: a problem's identity holds no offset. The reader typing
> above a failed call moves every offset below it and changes nothing about the
> failure, and an identity that moved with it read as a repair the reader never
> made. What tells two problems apart is the code, the object the failure
> names, and the section it was reported under; a failure with nothing verified
> about it — no object named, no call to repair it at — is its own problem
> every time one is found, because the words two of them share establish
> nothing.

> Amended 2026-09-13: retention is per preview surface. One attempt renders the
> note, the annotation, the Citation text, and a Shared Partial apart, so a
> note that failed beside an annotation that rendered keeps the last note that
> worked while the annotation shows what this attempt produced. Matching
> includes the Template Document, the same as the paper and the example: output
> kept for the document before this one is another preview's.

> Amended 2026-09-13: navigating to the source gives the pane back first. An
> explanation holding the whole editor would otherwise send the reader to
> source it hides, so the control that opens the pane a problem is repaired in
> leaves Expand behind and returns the area to its settled share.

The citation-template walkthrough showed a missing partial's name,
explanation, and two recovery actions squeezed into one source-line widget.
The preview repeated the failure. Researchers need room to read an
explanation and choose a repair while they edit the template.

The editor owns a dedicated Problems area for detailed template diagnosis
and repair suggestions. Source locations carry short markers that open the
corresponding problem. The preview names the effect on its result and links
to that same explanation. This keeps diagnosis available when the editor is
open without a preview pane and gives detailed guidance a stable home outside
the source text. The same responsibility applies to both hosts.

Expansion follows the reader's action. Automatic previews show a compact
problem summary while preserving editor focus, cursor, and scroll. Selecting
Show problem or a source marker, a failed explicit Run, and opening the
Workbench from a failed note operation expand the explanation. Later
automatic results preserve the reader's open or collapsed choice. A template
can be temporarily invalid while the reader types; this behavior keeps that
editing stable and provides immediate guidance after a deliberate failed
attempt.

Diagnosis leads with a plain explanation and a text suggestion for what to
check or change. Readers make repairs through the normal editor and settings;
diagnostic controls serve navigation, disclosure, and reporting. This keeps
the Problems area simple and avoids a second set of editing workflows.
The repair location is separate from the engine's reported location: the
walkthrough's Citation text error was caused by the data supplied from its
calling note. Specific suggestions and navigation use verified causes and
targets. Unknown failures get a plain fallback explanation with their
original evidence; unavailable locations are stated explicitly.
Technical details start collapsed, with Copy error report available beside
the disclosure.

The copied report preserves the original engine message and available error
name, stack, causes, source excerpt, and reported location. It captures the
caller and repair target separately, together with the failure time, trigger,
Template Document and section, template language, rendering root and options,
selected Item/Annotation/example reference, and available ZotLit, host, and
engine versions. Unavailable fields are marked explicitly. It remains tied
to that attempt while the reader edits or changes the selection.
Technical details shows the exact report text. Copy error report remains
available while that disclosure is collapsed. This gives
issue investigation the original evidence while researchers can work from
the plain explanation. Ask the community links to the existing community
page beside Copy error report, giving the reader a direct route to help.
The copied report remains suitable for the existing debug-log collection
workflow. Full logs and template-data exports remain separate, explicit
collection steps. The debug-log guide explains the copy action when it ships.
The report is a bounded local record for inspection and manual sharing.

Preview failures retain the last successful output for the same template
and preview selection, labeled Showing the last successful preview. A change
to the selected Item, Annotation, example, root, caller Profile, mode, or
variant shows Preview unavailable when the retained output no longer matches.
This gives the researcher a useful comparison while repairing source and
keeps output from another preview selection out of that comparison. The rule
applies to runtime failures as well as document-parse failures.

The area shows one full explanation at a time with a selector for detected
problems. Occurrences group when their cause and repair target match; equal
message text alone does not establish this. Counts name the problems found,
including when a parser can only report its first error. Automatic checks
preserve the selected problem. If it resolves while others remain, its resolved
state offers Next problem so the reader controls the change of explanation.

Source and Problems share the editor. A draggable, keyboard-accessible divider
sets the open area’s share and retains it through checks and reopening. One
ghost chevron opens the area or closes it and restores source focus. Verified
source ranges carry persistent CodeMirror lint underlines, independent of the
explanation’s disclosure state. A red dot in a narrow left gutter opens the line’s diagnosis in
Problems; that panel owns the explanation.
Reporting controls stay outside the scrolling explanation, and long labels
wrap to keep them reachable.

Edits await the next automatic check, or Run in on-demand mode. Only a
successful applicable check clears the failure and publishes new output;
superseded or abandoned attempts cannot replace the current result or report.
An open Problems area keeps its size and shows No problems found in this
preview until the reader returns to the template or collapses it. The
inspected failure remains available as Copy last error report. A collapsed
area clears its warning and stays collapsed after success.

## Considered options

- **Detailed guidance in the preview:** meets the researcher where they
  inspect the result, but competes with that result and needs another route
  when the preview pane is closed.
- **An expanded block below the source line:** keeps one local error close
  to its source, but moves source text as problems appear and becomes harder
  to follow with repeated errors or errors in another template file.
- **Expand on every detected problem:** makes each explanation visible,
  but temporary editing errors repeatedly change the available source space.
- **Expand only on request:** gives the reader full control of space,
  but adds a step after an explicit failed attempt.
- **Engine message first:** gives template experts the original detail
  immediately, but asks other researchers to translate it into a repair.
- **Copy only the friendly explanation:** produces a short report, but
  loses the engine evidence and failed-attempt context needed to investigate.
- **Clear the preview on every failure:** makes the failed state
  unambiguous, but removes the last working output during a repair.
- **Repair buttons inside Problems:** shorten some fixes, but duplicate
  editor and settings workflows and add mutation handling to diagnosis.
- **Expand every problem:** exposes all explanations at once, but competes
  for reading space. One selected explanation leaves room for suggestions.
- **Keep a split at every size or collapse it automatically on success:**
  preserves simultaneous context or reclaims space sooner, but squeezes the
  explanation or moves the editor during a repair.

## Consequences

The Problems area uses editor space when expanded. Its space limits need to
preserve useful editing room. Diagnostics need structured causes and repair
targets for specific guidance, and captured technical context for reporting.
The current render path reduces errors to their message and publishes result
identities without retaining the failed request. Capture the original error
detail before that reduction and pair it with the attempt's source and
preview context. A source hash identifies content, not a unique attempt.
The existing CLI's preservation of engine source context
provides a precedent for this capture. The preview needs separate records
for the latest failure and the last successful output; a runtime failure
currently replaces the successful result with empty output. Capture the
attempt's triggering action to distinguish explicit Run failures from
automatic failures. Selection matching uses the preview's rendering root;
moving focus within the field explorer leaves that identity intact. The
detected-problem selector extends the first-only validation presentation in
[ADR 0032](0032-web-workbench-edits-one-source-document.md); parsers can still
stop at their first error. Draft saving and note-operation retry behavior
remain independent of preview success. Diagnostic suggestions require no
repair-command registry or mutation handlers.

Observable layout rules live in
[WORKBENCH-DESIGN.md](../../apps/docs/WORKBENCH-DESIGN.md#diagnosis-and-feedback).
This extends the local Annotation-format diagnosis in
[ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md) and follows the
shared behavior and host styling boundary in
[ADR 0044](0044-workbench-ui-is-headless-and-hosts-own-the-look.md).
Implementation scope and acceptance criteria live in
[spec #1078](https://github.com/aidenlx/zotlit/issues/1078).

A missing Shared Partial found during a Profile render carries that Profile document's path so the recovery action opens the call site. Keep it a subtype of the missing-template error so existing preview, notice, and CLI readers can handle it. Prefer the engine's structured source span when present. For Eta and other errors that report only line and column, locate the character in the source passed to the engine. Leave the span absent when there is no position. Unwrap Template service errors at plain call sites so their readers keep the external exception and diagnostic shape.

Carry the captured refusal diagnostic and report with a recovery request. Open the document that contains the unresolved call, or the Default Profile when the failure names no document. Explain the captured failure on arrival because a later check can report a different problem. At the synchronous Template and Profile edges, preserve the original cause so plain callers can still read the engine's diagnostics.

Use structured template names when attributing an engine error. Lazy template data can throw an application error whose message mentions a path, so a path in the message cannot identify the failing template. Traverse error causes, LiquidJS original errors, and arrays of errors nearest-first. Preserve a typed inert failure. Use the recorded compile error for a named template whether it was called directly or reached through an include. Keep the message, engine excerpt, and source span when available.

## Attribution and retained repair marks

Treat the engine location, the document that contains the call, and
the call's source range as separate facts. Use the Liquid token to locate
the failure within the template the engine named. A named Template
error can supply the template identity alone. Keep Eta's message as
diagnostic text without inferring a structured offset. A synthetic
document reference supplies no vault path. Use a verified unique call
for a failure in a named template. If the named partial is missing,
use the first call because each call needs the same repair. Citation
input mismatch requires runtime evidence and a verified caller. When
two attempts report a failure, deduplicate by structured cause, never
by equal message text.

Find a retained mark in the author's current text only while it still
holds the failed value. A Liquid token's source text must occur
uniquely. A single-line block scalar can omit the trailing newline YAML
added for the engine. A JSON-e mark requires both the reported path
and the same value at that path. Narrow a single-operator fault to an
unknown operator key or its lone expression when that gives sufficient
evidence. Missing required branches and ambiguous paths keep the
whole node because a sibling with the same key may have succeeded.
[Render attribution](../../packages/workbench/src/render/attribution.ts) · [Repair marks](../../packages/workbench/src/render/locate.ts)

### Report capture and preview retention

Capture the failure and context from the same attempt. Technical details
and Copy error report use one serializer. Walk causes breadth-first
through `cause`, Liquid's non-enumerable `originalError`, and aggregate
`errors`. A plain wrapper can lead to an Error, so follow its links and
record only the Errors. Capture source excerpts and raw engine text
before reducing the failure to a diagnostic code. Keep host copy in
the localized code and parameters. For a parser problem, use the same
report with its source revision and diagnostic range. No render attempt
or Item appears if the parser stopped the run. Preserve multiline
evidence as separate text blocks.

Give attempt sequence its own identity because two attempts can read
identical bytes. A source hash tracks the revision, while preview
retention matches the selected data, caller and mode across edits.
Keep the newest output for each surface. The note's Properties and
Annotation marks stay with its body. A successful empty string is
output. A complete result keeps its object identity so subscribers
can recognize it as the same publication.

Render the note name and Annotation Section independently before the
note body. Keep a failure on its own surface and let the other
surfaces finish. A note-name repair offset refers to the decoded scalar
text the pane shows. A whole-document search could find the same
partial in an unrelated body call, so it cannot supply that repair mark.
Use verified call text to identify a repair independently of its offset.
For a Properties row, show the innermost engine message because the
row already identifies the entry.
[Error report](../../packages/workbench/src/render/report.ts) · [Render result](../../packages/workbench/src/render/result.ts)

When a host explains diagnostics in its own status line, use the shared
underline-only extension. CodeMirror suppresses the hover tooltip when
the filter returns no list. An empty list still creates the tooltip.
[Underline-only diagnostics](../../packages/workbench/src/ui/underline-lint.ts)

If Copy error report fails, open Technical details so the existing
report can be selected and copied manually. Keep the action controls
outside the scrolling explanation so they remain reachable.
[Problems area tests](../../packages/workbench/src/ui/ui.test.tsx)

### Problem reading and source navigation

Present parser and renderer findings through one Problems area. Count
only findings the checks reported because a parser can stop at the
first error. Localize the condition and recovery from the finding code
and parameters. Keep the engine's wording as evidence. A finding tied
to a preview surface uses that surface as its subject before the
input root. Group occurrences only when the problem and repair identity
agree. Grouping an engine failure also requires a reported source
location and captured cause. Retain each occurrence's own evidence.

Keep the selected identity stable while the open area receives new
checks. If that problem goes away while another remains, offer
Next problem without selecting it. Closing the area returns focus
and space to the editor. Automatic checks keep the current disclosure.
Open on an explicit failed attempt, source marker, or Show problem.
The explanation scrolls separately from its controls.

Capture parser reports only when the clock is available. In the browser
a first check can precede the Temporal polyfill. Keep the first report
for each current parser problem and discard its entry when it is no
longer found. Retain at most the last inspected report after repair,
so it remains available for copying. The selected problem's report
takes priority. Use the same report text for Technical details and
the clipboard.

Route a problem to the editable field, Properties row, or source pane
that can repair it. A verified call takes priority over the reported
render surface. When its source location is gone, keep the current
editor position and explain that the location is unavailable. Close
the explanation before moving the caret if it obscures source. Close
the Fields popup on a reveal so focus reaches the editing pane. A
repeat reveal uses a new selection request.

Source marks are available whether the Problems area is open or closed.
Convert verified locations to the pane's shown offsets and remove
trailing layout whitespace for JSON-e. Attach a property or filename
failure only to the pane that owns its expression. Mount a keyboard
control next to affected lines and drop that gutter when the pane
becomes clean.
[Problems area](../../packages/workbench/src/ui/problems-footer.tsx) · [Problem grouping](../../packages/workbench/src/ui/problems.ts) · [Repair routing](../../packages/workbench/src/ui/problem-route.ts) · [Source diagnostics](../../packages/workbench/src/ui/source-diagnostics.tsx)

### Workbench core render evidence

The core renders a Profile against an Item Snapshot without CSL processing. The view handles Citation Template and Shared Partial previews, and synthesizes a note for Update when the host has none. The result and scheduler share a source and snapshot identity stamp so the editor can discard stale output. Attribute errors against the exact source supplied to that render. The Workbench scans the caller's template calls to name a missing Partial and locate the call that reached it. On a later edit, find the source again and verify that the target still identifies the same call. For a missing Partial, use the first matching call. Use the JSON-e operator catalog to verify whether a JSON field identifies an operator. Locate a filename error in the note-name template shown by that pane, independent of how the manifest quoted it.

Capture document parser failures using the same report shape as render failures. Record the source revision and exception evidence once. The parser runs automatically on each edit, before a render has read an Item Snapshot, so the record carries no snapshot or engine location unless it has direct evidence.

### Problems layout and navigation

Keep the explanation scroll surface keyboard-focusable and draw its focus ring inside because Obsidian suppresses outlines. Put disclosure and reporting controls below that surface. The divider serves as the open area's top border and crosses its error mark. Allow long translated control labels and engine template names to wrap. Keep the report itself preformatted and scrollable in both directions so the caret in a source excerpt stays aligned.

Use the problem selector as the object heading when several problems exist. Keep the user's chosen pane size through checks, repairs, and reopening. Show each occurrence's engine location separately from the verified repair site. An unclassified failure shows the first line of its evidence while the full report retains stack and excerpt data. If a parser check runs before Temporal is available, capture its report on the next eligible render.

Repair routing closes Fields and preserves the current panel choices. It offers textual repair instructions, with the explicit Add to template action inserting the Annotation loop. Navigate only to an insertion caret the user placed in a slice that still exists. When focus moves to a source call, announce the condition through the Problems status.

When a diagnosed field is inside collapsed Profile details, open the disclosure before revealing and focusing the control. Keep Show problem in the failure sentence as a link-style action.

The desktop renderer captures exception evidence before turning it into a diagnostic code and message. Keep the stack and source excerpt for the copied report. Share call attribution with the core renderer so both use the exact draft the failure read. A plain template declares its own language. An unparseable Profile uses Liquid for call scanning.

When a note operation refuses, offer to open the Template Document that supplied the failing call. Use the built-in Default if no document is named and present the arriving problem in that Workbench session.

Capture the Workbench report context once for each failure. A linked, pinned preview reports the Item it actually rendered. Keep a refused note operation's arriving report even when the editor's own check differs. Consume the arrival once and open its explanation. A deliberate request foregrounds the editor, while an attempt result leaves the reader in the current pane. When the manifest has no parsed field pane, route problems to available source. Keep form values from the last parsed manifest during repair. A new applicable success clears the active failure while the last inspected report remains readable. Measure the source and Problems region itself to place its explanation.

Use one native hover popup per host view and route its work through the leaf
runner. Native completion follows Obsidian's suggester keymap. Put a tag's
syntax and example in its documentation popup so completion rows stay
compact. The Workbench and Template Data Explorer share the native clipboard
operation.

Without an insertion target, Fields keeps path search available and
explains the disabled insert in its key hint and Mod+Enter notice.
Preview's Show problem uses the shared repair command. In both
panel layouts it focuses the failing Partial call, scrolls it into
view at the editor height floor, and announces the failure in the
editor status.

### Diagnostic identity and recovery

Use the same diagnostic record for Workbench renders and refused note
operations. Hosts localize the diagnostic code and parameters, while
preserving engine or host text when those fields cannot describe it.
Keep engine locations in the named template's own one-based coordinates.
A repair location identifies a verified call in the source that was
actually read. Keep the same call recognizable across offset changes.
An unknown call stays unknown. A missing Shared Partial is a typed
diagnostic. A Citation input mismatch requires runtime evidence of a
direct root read and a verified caller.

Name the failed pane so other surfaces keep their previous results.
Resolve JSON-e paths, Liquid spans and entry positions only against
matching authored text. A Managed Frontmatter diagnostic without a
responsible entry goes to Advanced. Preserve the caught engine evidence
and the failed render's source identity, Citation Variant, example,
Partial context and Profile. The source revision uses FNV-1a. Freeze
the attempt so later edits and selection changes cannot change its
report. Technical details and Copy error report use one serializer.
Capture parser refusals with the same record and mark missing values
unavailable.

Share the recovery notice across note operations. Give the Workbench
the captured refusal so it can explain a failure that a later check
does not reproduce. Open beside the originating leaf when it is supplied.
[Diagnostic](../../packages/notes/src/core/template/render-diagnostic.ts) ·
[Error report](../../packages/notes/src/core/template/render-report.ts)
