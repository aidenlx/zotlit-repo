---
status: accepted
---

# The Literature Note body is the user's, and rendering has no side effects

Amends ADR 0001 (the 2026-07-02 default put a Child Note list in a Managed Region, and rendering a `noteLink` imported the Child Note).

The default Literature Note Template has no Managed Block. Its body renders once, when the note is created. After that the body is the user's: Update refreshes the Properties and leaves the body as written. The `## Annotations` Query Block stays in the default, outside any Managed Region, because it is a live view and does not need to be re-rendered. The `## Notes` list of Child Notes is removed from the default.

Rendering `noteLink` never imports a Child Note. When an Imported Note exists for the Child Note, the link goes to that file. When none exists, the link is `[<title>](zotero://select/…)`, built with `itemSelectUri`, the same URI the Query View table uses for note rows. A Child Note becomes a file only through an explicit command: import child notes, import all notes, or batch import.

The flow is a one-way ticket from Zotero to Obsidian. A Literature Note body and an Imported Note are copies that ZotLit takes when the user asks: at creation, or when an import command runs. There is no automatic sync and no two-way sync: an edit to the copy never goes back to Zotero, and a later edit in Zotero reaches the copy only through an explicit re-import or Overwrite. A Query Block reads Zotero live; it is a view, not a synced copy.

The shared reason: **the body is the user's, and rendering has no side effects.** The research on branch `research/note-refresh-user-needs` (`docs/research/note-refresh-user-needs.md`, sections "Copy versus live view, after D1 and D2", "Zotero child notes: does anyone need the implicit import?" and "What the needs imply for the managed region") found that:

- users who write in Obsidian do not want ZotLit to rewrite the part of the note that they own;
- the implicit import created files silently, froze them after the first render, and had no setting to turn it off;
- the users who want Child Notes in the vault want either a one-time move or a current view, and an explicit command or a live view serves both better than a side effect of rendering.

## Considered options

- **Keep the Managed Block and drop only `## Notes`.** Rejected. The only thing left in the region would be the Query Block, which is already live, so the region would only add markers that the user must not touch.
- **Keep the implicit import behind a setting.** Rejected. A render that writes other files makes Preview, Update and Overwrite hard to predict, and the explicit commands already cover the need.

## Consequences

- Existing notes are not migrated. A note that has `%%zt-managed%%` markers keeps them: when its Profile has no Literature Note Template document (the built-in default), Update re-renders the region from the `content` slot, now without importing. Removing the two marker lines stops management, and Update then leaves the body alone.
- A note with markers whose Profile uses the ejected or duplicated built-in document gets the "no Managed Block" notice on Update, because that document has no Managed Block. The template is now the user's, so the user adds a Managed Block if they want one.
- The commands do not change. For a default note, Update refreshes the Properties, plus any Managed Region that the user's own template has. Overwrite replaces the whole body after confirmation.
- Previews and the Template Workbench show the same `zotero://` link that a real render writes.
- Out of scope: a live view of Child Notes ([#1686](https://github.com/aidenlx/zotlit/issues/1686)) and annotation comments kept in Obsidian ([#1685](https://github.com/aidenlx/zotlit/issues/1685)).

The legacy Managed Region transform wraps only the name supplied by the host, with equivalent output for an include or a direct render. A blank line before the closing marker gives it its own block after a callout, so Live Preview leaves it visible. Render a replacement only after finding the first marker pair and insert the result literally so Markdown dollar sequences keep their meaning.

Preserve existing Query Blocks by ordinal position within that region so toolbar edits survive. Recognize fenced blocks by their marker, length, and info string, and replace matched blocks from the end so earlier line spans stay stable. A new block without an earlier counterpart keeps the rendered source.

Use the same write-free Literature Note composition for Create and Note Preview so both produce the same bytes from the same inputs. Prepare Managed Frontmatter before rendering the body and return a refusal before Create writes anything when an entry fails. Reuse the refused evaluation when a lenient preview needs the other fields and their positions.

Only a vault override of the legacy content slot keeps its Managed Region on creation. The bundled content renders inline.

Look up an Imported Note by the Child Note's Indexed Key so the mirror can move within the vault. Use its current path and the Zotero title as the default alias. A title change can update the displayed link without renaming the mirror. If there is no mirror, link to the Child Note in Zotero. Rendering the link performs no writes. [Child Note link](../../packages/notes/src/obsidian/note-import/child-note-link.ts)

### Paired note body proof

Set aside the Fixture's notes before checking a new default
Profile render. Its Query Block is outside any Managed Region
and reads the Item's current Annotations. A sort change
rewrites the block source. A full update preserves the body
with no Managed Region. A legacy static listing inside a
Managed Region can migrate to the Query Block on full update.
Use the legacy text as the starting state and preserve the
citations and Attachment links below that region.

[Paired Literature Note cases](../../packages/e2e/src/paired-run.e2e.ts)

Keep the originating Literature Note in the Workbench session, independent of the Preview Item or focus changes. A later launch supersedes an unfinished target lookup. Update joins an in-progress update, saves the template, waits for compilation, and checks both the saved source and its revision before writing the note. The note operation checks the Item key in the content being replaced. A changed target or source revision cancels the write. Closing the Workbench interrupts the operation before it writes, and an already started write finishes. Report template-save and note-update outcomes separately. Mark the session's note unavailable if its key changed.

The CLI and Preview compose the same in-memory baseline. Profile checks
use that write-free composition and execute each contribution on its own,
including one check per independent Managed Frontmatter contribution.
Apply result disclosure after all checks finish.

### Desktop batch proof

Wait for metadata cache publication after a write before running a
command that reads the paper key or Profile stamp. A file is briefly
unstamped in cache while the parser replaces its entry. An unsaved
editor change can disagree with that cache. Keep the explicit
Profile choice local to one create, with Default preselected.

The update-all case also proves full Literature Note rendering. Use
the multi-item confirmation path after asynchronous classification.
Check related Items and Collections from the render, since the seeded
heading and keys alone can pass when no render ran. Characterize
renderer painting during worker-backed queries. Restore any seeded
notes displaced to exercise creation. Creation writes one vault
file and imports no Zotero Child Note. A full update refreshes
managed Properties without rewriting the reader's body. The first
update after a template edit must apply the new Managed Frontmatter.
[Desktop Literature Notes](../../packages/e2e/src/literature-notes.e2e.ts)
