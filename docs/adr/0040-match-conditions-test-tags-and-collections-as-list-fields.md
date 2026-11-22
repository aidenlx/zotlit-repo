---
status: accepted
---

# Match conditions test Tags and Collections as list fields

[ADR 0038](0038-profile-selection-rules-belong-to-the-vault.md) gave the condition contract three global predicates — `hasTag(name)`, `inCollection(library, key)`, `inCollectionDirectly(library, key)` — and a Collection reference of Library selector plus Collection key. [ADR 0039](0039-a-profile-match-lives-in-the-profile-document.md) moved the match into the Profile document, made references names, and left the leaf syntax to the Filter Expression work. The grilling on 2026-09-06 settled that syntax on the [Obsidian Bases function vocabulary](https://help.obsidian.md/bases/functions), which the match editor and the Match tree already mirror.

**Tags and Collections are list fields.** The contract exposes `tags`, the Item's Tag names, and `collections`, the Item's Collection paths, as list-typed fields. The accepted tests are the Bases list functions on those fields — `contains`, `containsAny`, `containsAll`, `isEmpty` — plus `collections.within(path)` for filing in a Collection or any of its subcollections. `!` is the only negation, so a negated `containsAny` or `containsAll` has no labelled row and stays an expression row. The receivers and methods are hardcoded; a typed field registry is deferred until a second list field needs it. Tag matching stays exact and case-sensitive over manual and automatic Tags alike.

**A Collection reference is its path.** The names from the root ancestor to the Collection, joined by `/` without escaping; matching is segment-wise, so only a Collection name that itself contains `/` is ambiguous. One path names the same Collection in every Library the match covers, and a rename changes the path and the match stops matching until the user updates it. A path no Library holds is an ordinary nonmatch with a hint in the editor, under ADR 0039's unevaluable-match rule.

**One row shape for every kind.** A condition row is kind, operator, value. Subcollection scope is the operator (`within`, shown as "is inside", is the default; `contains`, shown as "is", tests direct filing), which removes the fourth control that made Collection rows wrap. Tags and Collections share one operator model and one multi-value input; Collection values offer the scoped Libraries' paths once each and accept a typed path that is not present yet, Tag values are typed freely.

## Considered options

- **Bases' own `file.hasTag(...tags)`**: variadic "any of" with nested-tag matching. Rejected because Zotero Tags do not nest and the list functions give any-of, all-of, and empty tests from one model.
- **Two Collection condition kinds** ("Collection, including subcollections" / "Collection, excluding subcollections"): keeps the global functions, but the pair reads as a sentence badly with any operator and doubles the kind list. Rejected for scope-as-operator.
- **`collections.contains` over Library-qualified keys**: keeps rename stability, but a key is not a name and does not read the same in another vault, which ADR 0039 requires.
- **Unknown path as a broken match**: rejected because portability is the point of paths; an absent path in one Library is a normal state.

## Match and creation checks

The Note Feature and the Template Workbench integration tests read Item facts through real ZoteroReads and ZotLit Query over a fixture database. Keep `setImmediate` on real time because the in-process ZoteroReads runtime schedules work through it. The creation cases include the same Collection key in two Libraries to verify Library scoping, and tags with distinct case and origin. The batch test crosses several read slices and counts queries to check that Items, facets, and matches are read in batches. It checks both overlapping profile rules and the case where the catch-all alone does not produce a selection.

The Workbench's provider keeps actual Collection path segments even though the expression syntax accepts slash ambiguity. Automatic tags and direct Collection paths still contribute to Match. The test runs two overlapping Match requests because two Workbench surfaces can open the pane at the same time.

## Dataset fields in the condition editor

Build the shared Query View and Profile Match field picker from the
Query Dataset's planner. Use paths relative to the dataset, so the Item
title is `title` for Items and `item.title` for Annotations. Offer common
fields first and derive the rest from the planner. A record can expose
its scalar members without offering the whole record as a condition.
Render unsupported conditions as expression rows. Host-provided fields
such as vault properties retain their names. Search aliases help in the
picker without being written into the query. Use bracket access for a
field name that cannot be written after a dot.
[Condition fields](../../packages/workbench/src/match/fields.ts)

### Match editor round trips

Read known filter leaves as labeled rows, and preserve other leaves
as authored expressions. Use All, Any, and None for the filter tree's
groups. A lone leaf takes an All group. Blank or valueless rows remain
visible while editing and store no condition. Drop an empty nested
group and leave one placeholder when the root has no conditions.
Keep the editor-to-filter row mapping so a Fault can name the right
condition after valueless rows are omitted. A drag target refers to
the group before removal, so adjust its path before insertion.

At commit, recognize the editor's own filter coming back from the
host. Apply a different external filter before the next keystroke so
a delayed echo cannot rebuild the current row. If the host changes
to a vocabulary that no longer offers its row kinds, read the stored
filter in the new vocabulary. Keep the last valid Match while the
draft is invalid. Profile Match uses the Items dataset without Query
Context, Formulas, or vault properties.

Route undo to the document history except when a field or a host
popup has already handled it. An expression field's own undo updates
the Match, so stepping document history again would reverse that edit.
Focus the condition picker after adding a row. Use a searchable host
control for long choice lists, and native controls for short lists.
Where a host has no typing popup, supply a native datalist. Commit a
chip on comma or Enter and retain typed values that have no suggestion.
[Match draft](../../packages/workbench/src/ui/match.draft.ts) · [Match editor](../../packages/workbench/src/ui/match.tsx)

The Match tab checks the selected Item independently of preview render mode.
It uses the searchable Select for properties and operators, following Bases.
The other Workbench selects keep Obsidian's dropdown.

[Match pane](../../packages/template-workbench/src/obsidian/editor/match-pane.tsx)

### Filter editor proof

Test the saved file and view conditions separately. An empty
section supplies a placeholder and can start folded. A condition
edit reruns the view and the delayed save follows the rendered
rows. Leave the expression row populated during typing because
clearing its value removes it. Offer visual editing when the
expression fits one of its rows, and explain the missing
conversion in a tooltip otherwise.

Reordering saves the visual order and preserves grip focus under
Alt+Arrow moves. Place a drop on a group's body at the end of
that group. Reject a group dropped inside itself and allow a
nested condition to move out. A None group serializes as `not`
with disjunction between rows. Removing its last condition
removes the group, and removing the last top-level condition
clears the view filter.

[Filter editor cases](../../packages/e2e/src/query-view.e2e.ts)

Use wrapping chips for list-condition values. Keep free text available alongside any suggestions the host can supply.
