# The Annotation View is the Annotations Layout of the Query View

One Query View draws a Query File in its tab, a Query File embed, a Query Block and the sidebar Annotation View. The Annotation Cards, card editing, Card Selection and the Annotation Repository stay as they are and become the Annotations Layout, next to Table, List and Cards. The sidebar Annotation View is a Query View whose Query Context is the Item and the Attachment its Follow Mode gives; its filter is `attachment == this.attachment`, so it shows the Annotations of one Attachment as before. It shows only the controls that have a meaning for one Attachment — colour, tag, search, and, in its More options menu, sort, grouping by colour or tag, and "Filter..." for the full filter — and "Save as query file" turns its current state into a Query File.

Proposed on 2026-10-14 with [#1459](https://github.com/aidenlx/zotlit/issues/1459).

## Considered Options

- **A new query view next to the current Annotation View** (rejected): two card lists and two filter models for the same Annotations.
- **The full query toolbar in the sidebar** (rejected): view switching, properties, limits and grouping by Item have no meaning for one Item.

## Consequences

- `this` carries an Item and, when there is one, an Attachment, read as `this.item` and `this.attachment`. It is the note that embeds the file or holds the block, and the Item and Attachment the sidebar follows. It is also the Item selected in the Library View, for its Reading Card (ADR 0071). In a Query File's own tab `this` has no value, and a filter that uses it shows a diagnostic.
- The sidebar keeps the per-Attachment scope of the Annotation View, so the daily workflow does not change; "Save as query file" can save the Attachment or the whole Item.
- The query reads the Zotero database and can lag behind a Local API write. The Annotations Layout shows live records from the Annotation Repository in the order and groups the query gives, so a card edit shows at once.
- [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md) still holds in every host: reading never waits for the Editing Capability.

The Annotation Suggester reserves triggers that overlap the Citation Suggester or Obsidian's link suggester. Whitespace and the At Trigger marker are also unavailable. Match the last usable trigger before the cursor and consume the paired closing bracket when the editor inserts one. An empty setting disables the suggester.

Search the readable content of Zotero annotation text and comments. Paired inline formatting contributes its contents, and ordinary angle brackets remain searchable. The known unmatched-tag discrepancy is tracked in [issue 149](https://github.com/aidenlx/zotlit-repo/issues/149).

## Sidebar filters, export, and reveal

Keep the followed Attachment filter outside the dialog's editable Match tree. The Attachment can change while the dialog is open. Close pending custom-field reads with the dialog. Sort by an Annotation property because the Item and Attachment are shared across the list. Default to reading order. Group by color or Tag. Filter by a palette name only when it identifies one color. Use the hex value where a name is shared or absent.

Save the sidebar view through the Query File dialog. Combine its own filters with the filter bar and write a scope for the current Attachment, the current Item, or the Item of the enclosing note. Reuse the dialog for Library View export and name any state the file cannot represent.

Keep an on-screen card available to show conflicting values. Raise the conflict notice when the view does not show that card. Reveal the target Annotation through the registered sidebar, or pin it to an Item from the Reading Card. When a PDF opens through the Target Opener, honor the setting to bring the Annotation View forward. A Literature Note action from a bound PDF can finish after that PDF view closes. Open an existing note tab or create and open the note beside the PDF.

## Suggester search and insertion

Use database-only search so it works with Zotero closed. First find up to twenty matching papers by Last Activity. Then read their matching Annotations in reading order and cap the final suggestions. Every word must match readable text or a comment. Apply all requested Tags, any requested color, and the paper restrictions. At insertion time, read the selected Annotation from the live repository so a result found through older database text can insert the latest stored edit.

Cancel the previous search on a new keystroke. A superseded request returns null, which Obsidian skips. An empty list would instead close the popup. Own the rendered suggestions and their Markdown comments for one result set and dispose them on replacement or close. Capture the editor insertion destination before the Effect runs. Its fiber belongs to the plugin lifetime and stops on a cancelled destination or unload.

## Staging the next Item

Keep the current Item's header, Attachments, and cards together while reading the next Item. When the next cards arrive, commit them and the next header in the same render. After 150 ms, show the next header when available with its loading state and without the previous cards. A failure belongs to the Item whose run failed. An Item with no cards can appear immediately.

Dispose the old Item's save subscriptions before updating state for a different Item. Store subscriptions fire synchronously, so the old listener could otherwise save the new state under the old Item's key. A reload of the same Item keeps the subscriptions so a choice made while loading is retained. Remember the filter and Attachment choice against the Item's key, or against a standalone Attachment's key. Restore a saved filter after its Annotation list arrives. The query handles database refreshes itself, so a same-Attachment state refresh needs no duplicate query when the file is unchanged.

Read the followed Attachment's own repository list to show pending proposals before they appear in the database. Resolve comment links against the most recent Literature Note for the loaded Item. Use the vault root if the Item has no note. Closing the view saves an open card editor and unmounts its cards.

Share card focus across Query View hosts so the Annotation History palette commands use the Attachment of the focused card. The same commands can use the current Attachment of a bound PDF or Annotation View. The Query Views feature registers those commands because it can identify the active surface. Bring a card forward from a capability notice or PDF reader mark, and open the Annotation View beside a PDF from the shared Target Opener.

The Annotation Suggester has plugin lifetime. Its inserts use the runtime Scope so plugin unload interrupts pending inserts.

## Annotation Card styling in Obsidian

The Annotation View uses a full-height flex column to keep the toolbar visible while the card list scrolls. In Annotation Cards, retain the theme's prose styling and tighten block spacing, table text, indentation and rules for the narrow dock. Restore unordered-list markers after the scoped preflight resets them. Align task checkboxes with the card's list indentation because Obsidian's checkbox alignment targets Reading view.

Use unlayered overrides with scoped selectors for Obsidian's unlayered styles. Size card controls like property value controls so actions can fit on one line in a narrow dock. Drop the remove icon's padding so it fits within a tag chip in both the card and Mark Popup. Use `revert-layer` on excerpts embedded in Query Blocks, the header button, and the tag input. This lets ZotLit's utility layers supply their styles in each host. [Annotation View stylesheet](../../../../packages/annotations/src/desktop/annot-view/style.css)

## List refresh and test hosts

Report membership changes only for Attachments the layout shows. Changes to an existing card's fields render from its live list. When a membership change prompts a query, hold those results while the database still lacks a newly visible Annotation. A rerun of the same query leaves that wait in place. A new request, such as a filter change, supersedes the wait when it publishes its own rows.

Layout tests mount the host contract with an Obsidian app, a key Scope and Attachment rows that keep their own Editing Capability and Annotation Source. The shared registry tests accept extra services from each host. Close the mounted view before disposing those services. Editor transaction tests drive CodeMirror state without mounting its rendered view. The key test adapter records Scope handlers so tests can deliver keys through the same boundary as Obsidian. [Layout tests](../../../../packages/annotations/src/desktop/annot-view/layout.test.ts) · [Host fixture](../../../../packages/annotations/src/__fixtures__/annot-view/host.ts) · [Editor fixture](../../../../packages/annotations/src/__fixtures__/annot-view/editor.ts)

The layout releases the previous Attachment hold when the replacement lists arrive. Tag editors on duplicate cards read suggestions independently. Annotation insertion and citation reads use the view runner. Closing the view ends a citation read. The read returns a template diagnostic that the researcher can act on, or logs the underlying failure when it cannot read the Annotation.

Annotation Cards and the Annotation Popover share the excerpt, image and page-locator components. The Annotation Suggester draws the same rich text through a DOM helper. Both paths use Obsidian's sanitizer for Zotero inline formatting such as emphasis and subscripts. Localize a numeric page locator and keep a printed label as stored. Use the excerpt as an image's alternative text when available, or supply a localized description with the page label if known. [View commands](../../../../packages/annotations/src/desktop/annot-view/atoms.ts) · [Excerpt components](../../../../packages/annotations/src/desktop/annot-view/excerpt-parts.tsx)

## Annotation View presentation

Read stable slices from the store and derive header and body with memoized values. The external store compares snapshot references, so a selector that constructs each result at read time cannot settle. Keep the control row's collapsed state local to the pane because it belongs to the view alone. Draw the loading state where the first cards will appear. Keep the header chevron to the inline end of the text so its byline can wrap. Put separators after byline segments so a wrapped segment starts with text.

Focus a revealed search field in a layout effect, at mount. Give it a hidden label and use a text input so the browser does not consume Escape to clear a native search field. Escape clears the filter, closes the search bar, returns focus to its toggle, and stops the pane's Escape action.

Use a row-major grid so widening the pane preserves reading order. Use the scroll container's own width for its responsive tracks, or the requested minimum card width when supplied. Keep each card at its content height. Leave bottom padding and scroll padding so the last or newly focused card can clear Obsidian's fixed status bar. Fade the top of cards that scroll under the filter bar. Place the fade in the scroll container so it spans the gutters and leaves the scrollbar above it. When a resize clamps scrolling back to the top, the scroll handler clears the fade.

A group heading spans every track. Put the heading and its first card in a fragment keyed by Card Place so a change in the leading card does not remount its editor. A card can occur under multiple groups. Draw separators above subsequent group headings and keep the collapse chevron visible. Use Obsidian's native icon button treatment for the group toggle and style the heading text separately from the button. [Annotation View rendering](../../../../packages/annotations/src/desktop/annot-view/AnnotView.tsx)

## Layout host and list lifetime

The sidebar Annotation View and Query View mount the same card store, actions and selection. Host ports supply Follow Mode, pinning, the Attachment picker and the Template Data Explorer. A host that mounts controls in another root uses the layout's app and store providers. Comment links resolve relative to the note the host supplies, with an empty source path for the vault root. When an insertion menu stays open across a refresh, look up the latest record again when the user selects it.

Hold new Attachment lists before releasing the previous hold. Compose rows in query order from live records, and publish the next composed view once each Attachment has answered. A later read for an Attachment supersedes its previous read. Change the host's displayed Item in the same publish as the Attachment data. A changed Attachment set clears the view selection and then applies the bound reader's current selection. When the sidebar clears cards in advance of a query, keep an in-flight read for the same sole Attachment so its rows can still appear. Put new records into their repository list positions until query results catch up. Grouped rows wait for the query to determine their groups. Refresh data redraws Excerpt Images after the lists settle if the same Attachments are still shown. [Annotations Layout](../../../../packages/annotations/src/desktop/annot-view/layout.tsx)

The card overflow menu offers the same templated insertion as a drag so users can insert an Annotation from the keyboard. Each citation copy starts its own view-scoped read so concurrent copies can finish independently. Closing the view interrupts a pending read quietly. Render comments through the view's comment renderer, with its own source path and disposal. [Card actions](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

## Annotation Card presentation

Use the theme's Bases Card variables for the card surface and compose the selection accent with the focus ring. Keep card contents dense like a search match. Align the page chip and action bar on one row, with the overflow icon aligned to the text edge. Use the same icon button treatment as the Mark Popup. The overflow control remains visible while the edit controls at rest use the opacity selected by the card contrast check. That check measured 3.26:1 at 70% and 1.84:1 at 40% in the tested theme.

Pass the Zotero colour as a custom property to the page chip and excerpt rule. Use the link theme variables when the page chip is an anchor so its ink, weight, and decoration match the chip. Keep the rule on a text excerpt to distinguish the document's text from the comment. Use a neutral rule when there is no Annotation colour. Give an image its own edge so a white page remains distinguishable from a light card, and retain its aspect ratio under the collapsed height cap. [Annotation Card](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

The Annotation Card sends Zotero's stored comment HTML through the same Markdown conversion as the Annotation template. The preview and Literature Note then agree on Markdown syntax entered in Zotero. Share the converter across comments in a view. Register each render as a child of the view and skip the post-processing work when a render has been disposed. Resolve links against the current Literature Note at render and click time so a note created in between can still supply the base. Route internal links through the workspace's pane gesture and leave external links to their default anchor behavior. Keep a stable sanitizer ref while an excerpt's HTML is unchanged so surrounding renders leave the sanitized fragment in place. [Comment renderer](../../../../packages/annotations/src/obsidian/annot-view/comment-render.ts) · [Excerpt sanitizer](../../../../packages/annotations/src/obsidian/annot-view/sanitize-html.ts)

## Insertion placement and lifetime

The notes feature provides insertion and page-pinned citation rendering through the Annotation Note Actions port. An insertion can use a source snapshot held by a card or resolve a selected search result at send time. If the source disappears, report why the action cannot finish. Template and Profile failures can fall back to the Annotation's text. Offer Profile recovery when its diagnostic identifies a missing Profile, and report image results when an Excerpt Image needs attention. A citation can report that an item has no key, a record is missing, or the JavaScript Templates gate prevents rendering it.

Capture the editor and destination before asynchronous preparation. Track the range as unrelated edits move it. Overlap, Escape, disposal and a workspace change away from the note cancel the capture. Returning to a former note does not revive it. Remove the range tracker before the commit so the edit cannot cancel itself. Keep the work on the view's runner. A newer insertion cancels the previous one, and interruption leaves the notice silent. Use the active or recently used Markdown editor for menu insertion. A note in Reading view cannot accept it. Register drag cleanup on the originating window and handle only a drop with the matching payload. Use CodeMirror's nearest drop position, which can locate a drop over an empty line.

Share placement between asynchronous and synchronous entry points. Trim edge line breaks before choosing inline placement or placing a multiline block on its own lines. Inline text reuses adjacent space, keeps closing punctuation attached, and leaves the cursor after a trailing space where appropriate. A trigger already typed supplies its own leading context. Bracketed citations end at their closer so punctuation can follow immediately. Other citation forms leave a trailing space so a bare key cannot reopen the Citation Suggester. [Placement and capture](../../../../packages/annotations/src/obsidian/annot-view/async-insert.ts) · [Insert and drag actions](../../../../packages/annotations/src/obsidian/annot-view/drag-insert.ts) · [Note actions](../../../../packages/annotations/src/obsidian/annot-view/note-actions.ts)

## Annotation Filter and header presentation

Use a Chooser for filter selections because colour and Tag filters support multiple toggles in one popup. Colours use a compact swatch list, and Tags use search. Keep a trigger in place when it has nothing to offer, and keep it reachable when a selection can still be cleared. Put Clear in its own group when a selection exists, and leave it available while searching. The colour store still accepts one colour toggle, so read the single changed value from a Chooser tick. The clear action invokes its own callback. Keep the trigger's visual preview bounded and include the full selection in its accessible name. Align the trigger row to the header and let long Tag names shrink before they crowd out the other controls.

Match colours within their filter group and Tags within theirs by OR. Require both groups and the text query by AND. Canonicalize colours and use the Zotero palette order, followed by any other colours in first-seen order. Key Tags by name because the Local API provides no numeric Tag identifier. Order Tags by descending hit count and then name, without counting the active Tag filter. This keeps the list order stable when a Tag is toggled. Prune saved values that no longer occur in the loaded Annotations so a filter cannot act invisibly. Reject the old numeric Tag shape on load.

Compute the body, header and menu groups as presentation data so tests can assert the decisions without mounting UI. The header names the Item when the active tab does not already identify it. With an Item title, the Follow Mode uses its glyph and the accessible name includes its short label. Use the full mode phrase when there is no title. Join visible indicators in the same order for the accessible name. Let `aria-haspopup` convey the menu. Report an Attachment choice, a read-only reason or a closed Zotero Reader only when it applies. The capability probe stays quiet. Use a short menu label for the capability, and offer the authorization gesture only when it can resolve the block. Use the shared Open Target for the Attachment action when the reader does not already show it. [Filter row](../../../../packages/annotations/src/obsidian/annot-view/FilterBar.tsx) · [Filter logic](../../../../packages/annotations/src/obsidian/annot-view/filter.ts) · [Header presentation](../../../../packages/annotations/src/obsidian/annot-view/presentation.ts)

## View model lifetime

Mount each leaf's writable atoms from construction to close because a registry can release unread atom state on a later task. Keep the Query View's store exports available over this model for existing consumers. Read stable mutation and filter snapshots, and keep setters passed to a Chooser stable so it can reuse its groups. Allow one-colour toggles and whole-selection clear independently. The card tag menu and the Chooser use the same tag toggle rule.

Closing text search clears its query so the hidden field cannot filter the list. Clear-all can clear the selections without closing search. The sidebar restores saved colours and Tags for the displayed Item while the current text query remains local to the view. Keep a filter condition error alongside the last visible cards. Query rows whose records cannot be found are tracked separately. The host's Editing Capability is the fallback when a card has no per-Attachment capability. [View model](../../../../packages/annotations/src/obsidian/annot-view/model.ts) · [Card state](../../../../packages/annotations/src/obsidian/annot-view/state.ts)

Query Views fills the Annotation View Reveal port. The capability notices and Annotation Marks use it to check whether a card is already visible and to reveal it without depending on the sidebar host. [Reveal port](../../../../packages/annotations/src/obsidian/annot-view/view-reveal.ts)

The sidebar defaults to all card parts. The Query View can hide the rendered comment, tags and page label. An open editor or held draft can still occupy its card slot. After Markdown rendering, unwrap auto-linked tag anchors because hashtags in Zotero comments are prose and Annotation Tags have their own chips. Use Obsidian tag theme tokens for data chips without relying on its anchor-only tag selector, with variants for filter selection, availability, density and truncation. [Display flags](../../../../packages/annotations/src/core/annot-view/card-display.ts) · [Comment post-processing](../../../../packages/annotations/src/core/annot-view/comment-postprocess.ts) · [Tag chips](../../../../packages/annotations/src/core/annot-view/tag-chip.ts)

Accumulate repository changes by Annotation key so a batch that changes several cards can publish each result through one registry update. [Repository observations](../../../../packages/annotations/src/obsidian/annotation-repository/atoms.ts)

### Group, filter, and export proof

In the side dock, use the Annotation header's More options because
Obsidian hides the view header. Save grouping in the sidebar Query
File and persist the color filter for the Item. The Filter dialog
edits the sidebar's own Match and leaves the follow Attachment
constraint outside that editor. A saved query in a tab has no note
context for `this`. Embed it in the Item's Literature Note to check
the contextual filter.

[Sidebar query cases](../../../../packages/e2e/src/annotations.e2e.ts)
