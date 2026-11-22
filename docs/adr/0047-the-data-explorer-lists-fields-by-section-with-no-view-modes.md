# The Data Explorer lists fields by section with no view modes

The Data Explorer showed one of two views, Simple or All fields, chosen by a
segmented control above the list. The views shared every mechanism — search,
tree, row actions, menu — and differed only in which fields they listed, which
words named them, and how dense their rows were. The control took a 33 px
row in a 340 px sidebar, the two names told a researcher nothing about the
difference, and three always-visible icons per row put about 120 icons on
screen in All fields.

Decided in the Data Explorer grilling on this branch (2026-09-10): the
Explorer shows one tree grouped into sections. Common fields lead in the
fixed order typing completion already uses; every other field has exactly one
home in a category a researcher recognizes — Reference, Identifiers, Content
and files, Organization, Links, Zotero record for an Item; Annotation, Source,
Organization, Links, Zotero record for an Annotation. A field the taxonomy
does not name joins the first section, so an item-type field or a new contract
key is never lost. Every top-level row shows a human name: ZotLit's own label
where it has one, otherwise Zotero's field label from the bundled schema in
the reader's locale, in sentence case for English. The raw path stays in the
tooltip and in Copy path, and search matches name, key, and value.

Rows share one density. Each row carries two actions, Insert and a menu,
revealed on hover or focus and always visible on touch; Copy value and the
snippets live in the menu, which a right click also opens. A section's closed
state replaces the view mode in persisted view state. In Obsidian the pane
menu and a view action collapse or expand every section, and the in-content
heading appears only in a sidebar, where the native title is hidden.

The note-name root hides `notePath` and `noteLink`, which the contract keeps
as stubs that are empty for every item.

## Considered options

- **Keep two views, move the switch into native chrome**: removes the pill
  but keeps two vocabularies for one list and an unlabeled icon toggle in
  the sidebar.
- **Two sections only, Common and the rest**: no taxonomy to maintain, but
  thirty raw keys in one alphabetical block under the common rows.
- **Zotero's item pane sections as the taxonomy**: familiar names, but six of
  its ten sections hold one row each in a 340 px sidebar.
- **Raw keys outside the common fields**: keeps the key an author types
  visible, and mixes "Published in" with `containerTitle` in one category.

## Consequences

- `@zotlit/zotero-types` exports `field-labels`, generated from the schema for
  the bundled locales, so a Zotero field needs no ZotLit message.
- `@zotlit/workbench/ui` owns the taxonomy in `explorer-sections.ts`; a new
  contract key lands in the first section until it is placed.
- The Obsidian view persists `collapsedSections` where it persisted `variant`;
  a saved `variant` is ignored.
- ADR 0044's projection table names Simple/All; this decision replaces that
  field with the closed-section set.

## Data tree, search, and snippets

Use the root's fields directly without a synthetic root row. Format
numeric steps with brackets, identifier steps after a dot, and other
keys with quoted brackets. An Annotation anchor uses its current key
and can disappear after a refresh. Display opaque objects such as
dates through their string form. For records, use their own formatted
value when available and use a size hint otherwise. Compact previews
collapse whitespace and truncate to one line. Copying a container
omits circular back-references.

A list can show its items or the properties of those items. Mark the
property path through all items with `[]`. A plain-value list has no
property rows. Use one rule for list row previews, details, and snippets.
Use items directly when they print meaningful text. Otherwise prefer
the first property that prints text for every item that supplies it,
then one that prints for some, then the first property. Treat an unread
getter as absent and skip blank values in snippet loops and joins.
Use the actual string conversion, including custom conversion hooks.

The default insertion uses the first snippet the node supports. Lists
can insert joined text or a Markdown list loop. A backlink uses a
Markdown link, so a list of backlinks uses a loop instead of a join of
raw URLs. An item with no value contributes neither a separator nor a
line. Liquid can invoke a link helper through its accessor. Eta inserts
the explicit call. Show a snippet's result through the same value
rules without running its generated template.

Match fields by key, label, path, or searchable value without regard
to case. A path match stops at the field the query addresses. Walk the
full tree and retain matched ancestors even when the user temporarily
collapses a filtered branch. Search collapse state stays separate from
the unfiltered expansion set. Changing an anchor restores the saved
root expansion state independently of the current filter.
[Display tree](../../packages/workbench/src/explorer/display-tree.ts) · [List values](../../packages/workbench/src/explorer/list-items.ts) · [Explorer snippets](../../packages/workbench/src/explorer/snippets.ts) · [Tree state](../../packages/workbench/src/explorer/tree-state.ts)

### Field labels and insertion

Share familiar labels and their common-field order between discovery
and Template Completion. Within a section, use Zotero's Info pane
order. Show one spelling of aliases and leave empty filename link
stubs out. Use the common label first, then ZotLit's label, then
Zotero's localized label, then the key. Use sentence case for English
labels and preserve acronyms. Note Annotation rows use Annotation
labels for their list properties. Place new fields in the first
section until the taxonomy assigns them. Nested Citation fields stay
under their top-level lists.

The field details preview, Insert, Copy, shortcut, and row menu share
the insertion formatter. Read the host's caret context at the time of
the action. Template output can offer joined and loop forms for lists,
and the row menu can also offer a guarded form. A Properties value
keeps its list value and inserts the corresponding Liquid or JSON-e
expression. A list property in Properties maps across its items.
Shift insertion keeps the panel open and leaves its focus in place.

Show details beside their row when the view and host support it,
otherwise use the fixed details bar. When the bar is too short, scroll
it to the generated snippet first. A click keeps focus in search.
Opening details with Enter moves focus to the form choice or first
available action. Tabbing out returns focus to the panel. Number
all list values and mark missing ones in details, while the inserted
form skips them.
[Explorer sections](../../packages/workbench/src/ui/explorer-sections.ts) · [Field details](../../packages/workbench/src/ui/field-details.tsx) · [Field insertion](../../packages/workbench/src/ui/field-insertion.ts)

### Explorer presentation and scrolling

Keep filtering and expansion under host control. The Fields Panel
shows list properties, while the standalone Explorer can show list
indices. Open all matching sections during a filter and announce a
no-match result until search changes. Clear the selected row and
details when the search changes or no longer exposes their row.
Arrow-key selection scrolls the row below its sticky heading.
Expanding or collapsing holds the acted-on row in place. A temporary
spacer supplies room at the end and shrinks when it scrolls out of
view.

A click outside the details and their row closes them. Return focus
to search if the closed details left focus at the page body. Keep
row actions out of its accessible name. Its visible key or label
names it and its displayed value describes it. Named rows show list
counts in prose; raw keys can use structural count hints. The web and
Obsidian themes share the selected attribute value. The standalone
tree can wrap long values separately from the label. Fields keeps
each row to one line and shows the full value in details.

Build a menu at the click position for a context action or under the
menu button. Read the current insertion context before offering copy
forms. Offer only engines the host currently permits in template
source. A Properties insertion has one value form. Announce inserts
and show why insertion is unavailable when no editor target exists.
[Explorer presentation](../../packages/workbench/src/ui/data-explorer.tsx) · [Explorer rows](../../packages/workbench/src/ui/explorer-tree.tsx)

### Native pane and export

All in-vault entry points share a serialized opener. An explicit pane type
gets a fresh leaf. Otherwise reuse the free sidebar leaf. Open the
standalone Explorer with its own Item even when an editor is open. Wait for
Obsidian to load a new pane before reading its view. Both authoring panes
remember the last Item in vault-local UI state. Each Explorer leaf owns its
JSON export so closing one leaf interrupts only its export.

Show recovery actions in the states that need them. Keep the pane toolbar
across the full width and let the tree scroll beneath it. Local unlayered
styles override the native heading and icon rules. Search holds all
sections open, so restore the heading's full opacity and dim the chevron
alone.

[Explorer opener](../../packages/template-workbench/src/desktop/data-explorer/register.ts) ·
[Explorer styles](../../packages/template-workbench/src/desktop/data-explorer/style.css)

### Standalone Explorer state

Keep the standalone Explorer independent of any editor. Older leaves saved as
an editor's Fields pane restore as standalone Explorers with their own Item.
Ignore the old file and leaf group, and offer copy actions without an editor
insertion target. In Workbench, the view's shared Item row holds its chooser,
and the sections control trails search. In the sidebar, space the toolbar
with the caption and Explorer padding.

Mount the Explorer model from leaf construction because Obsidian can restore
layout state before opening the view. Decode saved fields independently and
restore history presentation only for the same Item, root, and annotation.
A target change cancels the previous read and emits the new status or sample
data immediately. Preserve annotation choices for the same Item. Changing the
root or annotation moves the anchor and resets scroll. A new Item also resets
navigation. A Zotero revision refreshes the data. Template permission changes
update available snippet engines while preserving each leaf's navigation.

Use the chosen Item for a Citation set and the built-in example when no Item
is selected. Group the Citation root's own fields in Common and keep Item
fields nested under citations and items. Show a sample annotation immediately
while the library Item's annotation choices load. Keep the sample visible if
that read fails. Use bare keys for restored annotation anchors and Indexed
Keys for copied selections. Distinguish the note's annotation list from each
direct child row when resolving the selected annotation.

Use native data loading for export so the contract root can be reproduced and
device image handling stays with its loader. Export the chosen Item's root or
the selected library annotation. With an example annotation, use the library
Item's own data if one is selected. Sample Items and unparseable library
annotation keys have no export target.

Use the leaf's window and runner for its choosers. Concurrent requests for the
same chooser join. Later Item and annotation choices cancel earlier work,
while a search result cannot overwrite a more recent selection. Closing the
leaf interrupts pending work and releases the held export. Label the section
toggle by its next action, based on the sections visible in the pane.

[Explorer model](../../packages/template-workbench/src/desktop/data-explorer/model.ts) ·
[Explorer view](../../packages/template-workbench/src/desktop/data-explorer/view.tsx) ·
[Export](../../packages/template-workbench/src/desktop/data-explorer/export-file.ts)

Explorer fixtures use the plugin registry and keep each model mounted
until fixture disposal. Tests drive the same Item and Zotero notification
boundaries as a leaf. Pending reads are interruptible and the fixture
records which Indexed Keys were canceled. Wait for the last target's
final read to assert settled state.

The `obsidian://zotlit/explore` action opens the standalone Explorer on
the Item in the link.

Live Explorer walkthroughs check that permitted engines each provide a
field snippet.

The desktop explore link opens an independent Item beside the Workbench.
Changing an Item in either view leaves the other alone. A list row shows
its count and contents. The Each item form inserts one Markdown line
per value. A single-field institutional creator lacks a family name,
so the family-name forms skip it without an empty line or a trailing
separator. During rerender the prior full-name example may still show,
so identify the new family-only output in the Preview.
