---
status: accepted
---

# A Profile Match lives in the Profile document

> Amended 2026-09-09: the shared Workbench UI keeps the Match tab visible and disabled for Default. Named profiles keep the enabled Match tab and the existing Settings route to it. Default remains the fallback and carries no Match.

[ADR 0038](0038-profile-selection-rules-belong-to-the-vault.md) put automatic selection in a vault-owned ordered list of rules in `data.json`, each selecting a Profile by ID. The same-day revisit on 2026-09-06, held in greenfield mode because no rule format has shipped (`main` is at settings version 9), reopened it on three drivers: a reader of a Profile document should see which Items it is for, a shared Profile should be able to carry that declaration, and the declaration should be editable as text by a person, an agent, the web Workbench, and git, like the rest of the Profile. Under [ADR 0031](0031-a-literature-note-profile-is-its-document.md) the Profile is its document, so the rule list was the one piece of a Profile that lived elsewhere.

**The Profile Match is a manifest key.** Each Profile document may carry one `match` key whose value is a Match tree: a Filter Expression string, or an explicit `and` / `or` tree in the shape of an Obsidian Bases `filters` block whose leaves are Match conditions. An absent `match` means the Profile is never selected automatically; a present empty tree matches every Item. The Default Profile carries no `match`, as it carries no bindings, and is the fallback. There is no settings-side list, rule ID, rule order, or separate Library scope: a Library is an ordinary condition, written as `personal` or `group:<groupID>`, and Tags and Collections are referenced by name so a leaf reads the same in any vault. The leaf syntax itself is decided in the Filter Expression work, not here.

**Exactly one match selects.** Automatic Profile Selection picks the one Profile whose Profile Match matches the source Item. Two or more matching Profiles are a Selection problem: the picker opens with the candidates and the user chooses. A user who wants precedence writes exclusions. Selection precedence is unchanged from ADR 0038: the manual choice for the current operation, then a Profile supplied by a command or Companion link, then the Profile Match, then Default. Batches select per Item, and the preview fixes the current selection.

**An unevaluable match is a nonmatch with a diagnostic.** A leaf that names an unknown Collection or group, a leaf outside the contract, or a syntax error makes the Profile's match unevaluable: the Profile is skipped for every Item and its settings row shows the problem. A document that is excluded from the registry — a failed manifest, a colliding ID — is not a Profile and its match is inert; the existing excluded-documents banner is the signal. This replaces ADR 0038's "broken rules stop creation" line with the rule that configuration errors are visible where the configuration is, and never block new notes.

**The document is the editor, with a modal for convenience.** The settings Profile row shows the match in words and a button that opens the match editor, which edits or removes the `match` key through the same targeted YAML edit that Duplicate and Share use, leaving the rest of the document untouched. (Amended 2026-09-07: the match editor is the Match tab of the Workbench UI on both the web Workbench and the Obsidian Profile Editor, and the standalone settings modal is retired; the settings row action opens the Profile Editor on that tab, see [ADR 0044](0044-workbench-ui-is-headless-and-hosts-own-the-look.md).)

**The match travels with the Profile behind a toggle.** Share offers "Include match conditions", ticked by default; the import consent sheet shows the match in words behind an "Import match conditions" checkbox, also ticked. Omitting removes the key from the written file. Whether the names in a shared match mean anything in the recipient's Zotero is the user's concern; ZotLit does not repair references.

## Considered options

- **Keep the ordered list in settings** (ADR 0038): one place to inspect, and vault-bound references stay out of the document. Rejected because it is the one Profile fact outside the document, and the boundary it protected dissolves once references are names and sharing is opt-in.
- **Conditions in the document, order in settings**: re-creates the two-home scatter ADR 0031 removed.
- **A `priority` number per manifest**: explicit, but reordering means opening several files, and equal numbers need a tie-break anyway.
- **Unevaluable match stops creation** (ADR 0038's posture): rejected because an imported Profile with foreign names would block every new note; a visible row diagnostic serves the same need.

## Consequences

- `profile.selection-rules` leaves the settings schema without a migration; the rule list page, rule IDs, reordering, and per-rule diagnostics go with it. The rule editor is rehomed as the match editor on the Profile row.
- Profile deletion no longer warns about rule references; the match dies with the file.
- Spec [#971](https://github.com/aidenlx/zotlit/issues/971) and its child tickets are amended to this shape, and the settings reference page replaces the "Automatic profile selection" list with the per-Profile match row and drops "sharing or importing a Profile never carries them".
- The `apps/obsidian/GLOSSARY.md` terms Profile Selection Rule, Rule Filter, and Rule condition are replaced by Profile Match, Match tree, and Match condition.

## In-memory Match preview

Use Item Query's planner, evaluator, and first-fault diagnostic for a Filter Expression on an in-memory Item. The preview uses the Items vocabulary without Query Context or Formulas. A caller can supply a Query Clock. Otherwise it uses the instant and time zone of that call.

Store one live top-level Item as a JSON seed validated with `queryItemSeedSchema`. Keep its Library identity, present field values, complete source custom-field vocabulary, and Collection paths. The vocabulary distinguishes an absent value from a field the source does not define. The seed holds no Attachments, Annotations, or Child Notes. Report a filter that needs them as unavailable instead of returning a result from incomplete data.

Evaluate Profile Matches for multiple Items in one typed query over their Libraries. A literal list of Indexed Keys selects the requested Items. Evaluate each Match as a Formula using filter truth, so null and an Error Value are false. Preserve an invalid Match's diagnostic and continue evaluating the others.

Plan the stored Filter Tree using the Items vocabulary. An empty All group or a true expression matches every Item, while an absent Match makes no claim. A query that cannot read the Item is a failed selection. A Match that cannot evaluate for a returned Item does not hold.

Keep the prepared Profile choice fixed for one creation. If its preview becomes unavailable, ask the user to choose instead of silently substituting a different Profile. A failed Item Match requires a choice. A unique Match does not. Citation and Companion entry points can create directly from an explicit choice. Run a New Profile dialog on the same fiber as the picker so an interrupt closes it. Create from the path the dialog showed. Missing installed CSL styles leave the picker available.

In a batch, retain each new row's selection origin so a fallback only changes the rows that need it. Include all overlap candidates when offering a shared fallback. A Companion selection applies to new rows and leaves existing Profile stamps intact. Only an explicit all-new override changes that selection. A manual choice applies to its operation only. Leave the retired `note.last-used-profile` setting unread and unwritten. Re-render row details after a choice so the user sees the current Profile, reason, and path. Execution uses the confirmed path and verifies that the Profile still exists. A deleted Profile or an unresolved choice produces a row failure. [Batch update runner](../../packages/notes/src/desktop/note-feature/update-batch.ts)

The contextual New Profile dialog returns the Profile and any prepared note write to the current caller. The caller owns the write and uses the previewed path. Settings can open the same dialog without a source Item or note preview.

Let the picker return a New or Import request for the caller to open in its own fiber. Use the same effective Profile details in picker and embedded target rows. Put an unmatched problem between the input and results because the native suggester clears the modal content. Defer dismissal until after the native suggestion callback can deliver its selection. Give the focused Import button its own Enter binding above the modal's binding. Leave Escape and the arrows with the modal. Release the button's binding on redraw and close because a replaced button may receive no blur. [Profile picker](../../packages/notes/src/desktop/profile/profile-picker.ts)

Cancel concurrent Match editor reads when their view unmounts, before the
view registry's idle expiry.

[Match data tests](../../packages/template-workbench/src/obsidian/view/match-data.test.ts)

### Match controls and ordering

The Profile Match writes through its document controller and master history. The same condition controls serve Query View Filters. The caller owns saved rows and accepted field kinds, and confirms whether a proposed edit was stored. A saved filter that differs from the edited rows replaces their local state. After adding a condition, focus its kind control.

Let a host override part classes for its own layout. Keep short fixed choices in a native select and use the searchable plugin select for long or extensible lists. Search keywords stay separate from the display label. Offer values from the Libraries in the current dataset. Show a field path beside its label as in the Bases picker. Preserve the predicate label where possible and let its value move to another line when the row narrows.

During a pointer reorder, resolve the element under the coordinates if Chromium omits the related target. Capture the drag image before dimming the row. Position the drop indicator beside the row without moving the list, which also serves the Properties ordering control.

Test Match independently of the Preview mode. Supply vocabulary from all
Libraries in the pinned snapshot. Each caller uses its mount's runner so
closing it cancels the associated read. Evaluate a Sample Item from its
seed in memory and a real Item through the same ZotLit Query path used by
Profile selection. Attach diagnostics to the condition when a span exists.

For desktop Match coverage, use a real Item and its ZotLit Query
result. A blank Match has one placeholder row. A named-condition
diagnostic marks its own row after editor layout. A Syntax Fault
needs no Item query. Mod+Z in an expression updates the Match,
while Mod+Z in a select search updates only the search input.
