---
status: superseded in part by ADR-0117
---

# Landing on a Mark is an ephemeral-state contract read at the leaf

An Annotation's `fileLink` anchors to `#page=N`, so File Link Capture (ADR 0045) lands the reader on the page and the overlay draws every Mark there. The click came from one Annotation and should land on that Mark. ZotLit gives Obsidian's PDF view a capability of its own for this — an Annotation Anchor, carried the way Obsidian carries a subpath, read off the ephemeral state at `WorkspaceLeaf.prototype.setEphemeralState` — and the `fileLink` an Annotation renders becomes its first caller.

The leaf is where the Anchor is still readable. Read against Obsidian 1.14.2: `setViewState` hands the ephemeral state to the leaf, the leaf hands it to the view, and the PDF view parses what it knows and keeps nothing — it overrides no `getEphemeralState`, so the object is gone the moment the call returns. ZotLit's own `PdfViewBinding` is built later, off the `file-open` and `layout-change` sweep, and by then there is nothing left to read. `WorkspaceLeaf` is an exported class with a documented `setEphemeralState`, and every delivery path crosses it: a link click, a `leaf.openFile` from any caller, a deferred leaf replaying its stored state on rerender, and history. One patch on a public prototype covers them all.

The Anchor rides the subpath rather than a field beside it. Obsidian parses a PDF fragment with `URLSearchParams` and reads five keys — `page`, `offset`, `annotation`, `selection`, `height` — and silently drops the rest, so `#page=4&zt-annotation=KEY` still jumps to page 4 everywhere ZotLit is not listening. `openLinkText` already derives `eState.subpath` from a link's fragment, so the link and the ephemeral state share one spelling and nothing translates between them.

`zt-annotation` names an Annotation by its Indexed Key, per ADR 0033, because a fragment carries no library segment of its own.

## Considered Options

- **Patching `Workspace.openLinkText`** (rejected): the linktext arrives whole, and the symbol is public, but it sees link clicks alone — not a programmatic open, not a deferred replay, not history. Paired with Capture it would cover today's callers and none of tomorrow's, which is link plumbing wearing the shape of a view capability.
- **Carrying the Anchor out of band on ZotLit's own open path** (rejected): needs no patch at all, since ZotLit calls `leaf.openFile` itself in every gesture that matters. It is also not a contract — a hand-written `[[paper.pdf#page=4&zt-annotation=KEY]]` would do nothing, and the capability would exist only for its author.
- **Patching `PdfView.prototype.setEphemeralState`** (rejected): the truest reading point, one step closer to the view than the leaf, and it sees exactly the same callers. The class is not exported; reaching its prototype means constructing a throwaway view or waiting for the first PDF leaf, and waiting misses the first open of a session. The leaf gets the same coverage from a documented symbol.
- **Reading the Anchor at the leaf** (chosen).

## Consequences

- A warm view honours an Anchor, and Obsidian's own equivalent does not. `applySubpath` parks a highlight record that only the layer-rendered listeners read, so when the target page is already on screen no event fires and the record is never consumed — Obsidian's own "Copy link to annotation" lands on the first click and does nothing on the second. ZotLit resolves in one step gated on the binding's `refreshed` promise, checking whether the page is already rendered instead of waiting for an event that may never come.
- A pending Anchor is held per leaf, in a `WeakMap` the patch writes and the binding drains. It is dropped when it is applied and when the leaf's file changes. Obsidian's record has no such rule: `loadFile` clears the pdf.js subpath and leaves `subpathHighlight` behind, where it can fire against whatever document loads next at the same page number.
- The Anchor is also held as `setViewState` starts, from the ephemeral state it is passed. `setViewState` turns the leaf active, which fires `file-open`, before it calls `setEphemeralState`, so a cold PDF view opened into the active leaf is bound first. Without the early hold, an open naming the second Attachment of a shared file bound the path's owner, recorded a read of it and showed its Annotations, then rebound. The `setEphemeralState` patch still lands the Anchor and stands one down.
- A Mark Landing selects without opening the Mark Popup, which is an exception to the Popup's own rule that the selection alone opens it. A user who followed a link asked to see the passage, not for a popover over a document they have only just arrived at.
- An Anchor that cannot be honoured degrades to the page in silence, with `debug` logging and no notice. The Annotation may be gone, belong to another Attachment, have no position this build can place, or be unreadable while the Annotation Source is pending. `page=` is Obsidian's own jump and fires regardless, so a miss still lands somewhere defensible. When the two disagree the Annotation wins: the Indexed Key is the durable identity and the page number is a hint.
- The capability has no setting. `reader.open-file-links` gates Capture, but an Anchor reaches the leaf from callers that are not file links, so gating it there would be incoherent. It fails closed the way the overlay does, on a seam-probe miss.
- Emission changes for one field. `zt.annotations[].fileLink` writes `#page=N&zt-annotation=KEY` by default, an explicit `fileLink(alias, subpath)` override still wins, and `zt.attachments[].fileLink` is untouched. The default annotation template starts rendering that link on the page label, because it rendered nothing clickable before and the capability would otherwise ship invisible. Per-annotation output lives inside the managed region, so Update Note refreshes it.
- Claiming Zotero's own `zotero://open/...?annotation=<key>` marks is the deliberate next step, not a rejected one. Those links already sit in every imported Zotero Child Note, they reach the same patched `window.open` Capture stands on, and the Anchor's contract is wide enough for a caller that arrives with a bare key and a library segment. `zotero://select` stays Zotero's. The step is now taken: ADR 0045's consequences record how Capture claims these Durable Annotation Links.
- Landing stands on two undocumented behaviours: that `WorkspaceLeaf.setEphemeralState` is the only path the ephemeral state takes to a view, and that an unknown key in a PDF fragment is inert. Both are re-verified when `minAppVersion` moves. Where each one is read in the bundle is in `git show 452c5b598^:docs/pdf-annotation-probes.md`.

## Routing to ZotLit Reader

ADR 0117 replaces the next paragraph: a Zotero attachment opens in ZotLit Reader whatever its link carries.

`anchor-capture.ts` routes a native PDF `setViewState` call to ZotLit Reader
when its subpath contains a usable Annotation or Attachment Anchor. The
Reader passes the original subpath to the binding. A plain page link keeps
its original view type. Obsidian also sends ephemeral state for focus,
scrolling, and rename, so routing requires a string subpath.

Use one fragment codec for Attachment File Links and Mark Landing. The page is independently valid, so keep it if an Annotation Indexed Key is invalid. A caller that writes the fragment separator gets the body alone. An open that identifies its Attachment can also carry `zt-attachment`, because multiple Attachments can share one file. The codec reads its recognized keys while leaving Obsidian's own fragment keys available to Obsidian.

Use the Reader's navigation first when a requested Mark Landing needs an unpainted page. A record with no mark on that Reader does not move the page. Escape cancels a pending landing. Undo and redo can request the same landing for the changed Annotation. [Reader integration tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/service.test.ts)

A Mark Landing selects without opening the popup. Page paints preserve that choice until the next selection. A new note can select directly into its comment editor.

A quiet selection retains its popup choice in the Reader Surface State so a paint cannot reopen it.

Decide Mark Landing from data. Distinguish a complete empty list from a source that has not answered. The latter and an unresolved Attachment lookup can leave the Anchor pending. A terminal miss uses the page fallback and writes a debug record. Wait for the document before deciding its first placement. If the Attachment cannot resolve, handle the Anchor without waiting on an Annotation read that will never start. Use the first page a mark draws on when a range spans pages.

An explicit Card Selection supersedes a landing that awaited a read or paint. A navigation to a mark already in the selected group scrolls without reducing the group. A history deletion clears selection, cancels an older pending landing, and uses the Reader's page navigation to return to the removed mark's page. Scroll to the mark on the frame after selection so the native page jump does not scroll it away. [Landing decision](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/mark-landing.ts) · [Reader binding](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/binding.ts)

Pin the pages in the landing fixture independently of the grouping function so the test can detect a landing on the later page of a split range.

Check the parsed ephemeral state keys when proving an Annotation open.
The PDF view acts on those keys and can accept different spellings of
the same subpath.

[Annotation subpath proof](../../../../packages/e2e/src/annotation-open-subpath.ts)

Wait for the latest binding read used to decide a Landing. Another
read can replace the pending promise. PDF.js can clear Marks while
rendering the page, and the binding paints them again on the render
event. Check the page and the selected Marks after that paint. A
page-only Landing has no selected Marks.

[Landing proof](../../../../packages/e2e/src/annotation-links.e2e.ts)

Start with the PDF pages away from the target when proving a
card-triggered Landing. The target mark becomes visible
through the Landing's own scroll.

[Paired scroll proof](../../../../packages/e2e/src/paired-run.e2e.ts)
