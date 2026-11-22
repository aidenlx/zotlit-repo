# Workbench UI is headless and the hosts own the look

> Amended 2026-09-09: Profile Editor, Note Preview, and Data Explorer each own their view state. This replaces the original per-editor ownership across all three surfaces. Both hosts use the shared UI's independent view contracts; Obsidian passes values and actions through its vault, metadata-cache, and workspace events. Native linked tabs and Outline-style following determine context routing. Each receiver updates its own state. The ownership boundary lets each view initialize, restore, and close independently. Preview and Run use current draft text independently of save completion. Editors of the same Profile document synchronize live source through native `quick-preview`, while keeping their own controllers, undo history, item context, and view state.

Each view uses one local vanilla Zustand store. Its native `getState/setState` methods project the fields saved with the workspace; `getEphemeralState/setEphemeralState` project temporary navigation and presentation state for native in-session handoff. Shared components expose the narrow state values and restore actions those methods need. Controllers, undo history, loaded data and rendering jobs remain with their runtime owners. Native leaf groups persist association separately. This keeps host persistence out of the shared UI while making its state available to both hosts without store replication.

The state projections are concrete:

| View           | Persisted view state                                                                                                                                                                                                     | Native ephemeral view state                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Profile Editor | File or built-in reference, active tab, Source mode, item key for examples                                                                                                                                               | Active slice and selection, property/reveal target, editor scroll       |
| Note Preview   | Profile/item references, annotation choice, Create/Update, Live/On demand, Reading/Markdown and whole/managed choices                                                                                                    | Result scroll and reveal target                                         |
| Data Explorer  | Item and annotation references, authoring root, Simple/All (closed sections since [ADR 0047](0047-the-data-explorer-lists-fields-by-section-with-no-view-modes.md)), source reference when needed to reconstruct context | Search, complete tree expansion/filter state, scroll and revealed field |

Each native view reads these projections from its own store and restores them through its own actions. Changes to persisted fields request a layout save. Ephemeral restoration waits for the matching source and mounted pane, clamps old selections, and preserves focus unless focus was requested. ZotLit ephemeral fields are namespaced by view so slice coordinates cannot be mistaken for native Markdown cursor or scroll coordinates. Native ephemeral state supports Back/Forward, duplicate tab, and reopening a closed tab within the session; workspace restart uses persisted state. Document recovery and undo history keep their native/runtime owners.

The shared UI exposes controlled values and callbacks for Preview options, property selection, Explorer navigation, and selection/reveal restoration. Existing controlled panes remain the interface; Explorer search/expansion and focus-preserving selection restoration receive the missing hooks. The renderer accepts plain source, Item Snapshot, annotation example, and render options. Each Preview owns its scheduler and results. Compact editor examples have an editor-local render owner so closing Note Preview leaves them available. Keep these responsibilities in the existing cohesive modules with small store factories and providers; both hosts adopt them. Web composition uses callbacks and keeps its existing Save/download and draft-storage policies.

Annotation retains its separate tab and inline Edit format action under [ADR 0041](0041-annotation-format-has-its-own-workbench-tab.md). Match follows [ADR 0039](0039-a-profile-match-lives-in-the-profile-document.md): visible and disabled for Default, enabled for named profiles. A restored Default state that names Match opens the first enabled tab. Name and Properties show their configured values before an Item is selected, with separate no-item, loading, missing-value, and failed-result states. Folder controls show the effective value and its settings source. Template source uses monospace; labels and rendered notes use their host typography.

The web Template Workbench and the Obsidian Profile Editor present the same tabs, panes, rows, and result view over one Profile document. Decided in the Profile Editor grilling on map [#835](https://github.com/aidenlx/zotlit/issues/835) (2026-09-07): the two hosts mount one shared, headless component layer, the Workbench UI, exported as `@zotlit/workbench/ui` with React as a peer dependency, and everything in the tree that a user sees as colour, spacing, or type comes from the host. The shared tree renders structure and behaviour only: each component marks its parts with `data-part` and its state with `data-state` attributes, and an optional slot class map, supplied once through a theme context, lets a host attach its own class names per part. The theme also resolves icons by role through a host-supplied renderer. Call sites pass no classes. Anything that opens over the page is the host's: menus, dialogs and confirms, suggesters and pickers, tooltips and hover cards, and notices arrive through a host adapter in context, so Obsidian shows its own `Menu`, `Modal`, and `SuggestModal` and the web shows Base UI. Anything that lives in the page is shared DOM. Each host compiles the root catalog's `workbench_*` messages through its existing i18n pipeline and supplies typed message functions to the shared tree. The web uses its Paraglide facade; Obsidian uses its Language Pack facade, so Workbench labels follow the same installed pack and fallback behavior as the rest of the plugin. The shared package generates the message type contract; translation and locale selection belong to the hosts. The tree holds view state in a zustand vanilla store per view instance and stays inside the `preact/compat` surface because Obsidian's runtime is Preact.

## Considered options

- **Shared headless stores and hooks, host-written JSX**: keeps every host free to lay out its own markup, and duplicates every row, tab, and list twice; the duplication is the failure this decision prevents.
- **Shared styled components with a Tailwind theme per host**: one look forced on both hosts; Obsidian's preflight has to stay scoped under `.zt-root`, its utilities carry the `zt` prefix, and native Obsidian classes such as `clickable-icon` are what make a pane feel native, so the styles cannot be shared.
- **Portal controls in the shared tree**: a shared popup never looks like an Obsidian menu and never gets Obsidian's keyboard scopes.

## Consequences

- The web components are rewritten onto the headless tree with no behaviour change before any Obsidian UI exists; that rewrite is the first ticket of the spec and the proof of the DRY claim.
- The shared tree's tests run under both React and `preact/compat` in CI.
- The other `@zotlit/workbench` subpaths stay free of React.

## Decision details before the one-host amendment

The web Match tree and Properties list share their drag affordance. Draw the drop marker with an absolutely positioned pseudo-element so it can sit in the gap without shifting rows. The list passes its gap and border sizes as CSS properties if they differ from the defaults.

The host supplies an Effect runner tied to its owner. Observers distinguish
normal completion, interruption, and failure while preserving the host's
original cause. When joining a host fiber, install the interrupt
finalizer before the caller can be interrupted so an immediate cancel
still stops that work. The child fiber stays interruptible.
[Workbench host effects](../../packages/workbench/src/language/host-effects.ts)

## Editor views and chrome

Own one model per editor. Use the host's registry when given, or dispose
the editor's own registry with the editor. A tree without an editor
reads an inert model created on demand. Read the active host messages at
use time so a language change reaches hover and completion.

The host supplies component classes and named icons. The shared tree
exposes parts and states and derives the type of the host's class map
from its declared parts. A host can add editor extensions, completion row
cells, and searchable selects. With no override, use CodeMirror's list
and a native select. Keep short fixed lists native. Search keywords
remain separate from the displayed labels. Side panel sizes use custom
properties in the host's namespace.

Tabs use arrows, Home, and End. Keep visited panels mounted and hide
inactive ones so their editor views survive. Hidden slices report no
selection and accept no reveal. On becoming visible, a slice reports
its selection in master offsets. Keep current callbacks in a ref so
changing host props does not rebuild the editor. Keep the user's caret
placement across an editor rebuild for a language change. A scalar
pane shows only its value and refuses a line break. The whole-file
Advanced pane alone uses the line gutter.

Use stable portal hosts for Annotation and Shared Partial call boxes.
A selection touching a call reveals its source. Child controls can
act without revealing it. The Note preview's selected line lives in
master offsets so an edit in either pane can move it. Let the host own
scrolling so browser scroll anchoring holds the pane when a box changes
height. Put the focus ring outside the scroll container.
[Editor provider](../../packages/workbench/src/ui/editor.tsx) · [Editor boxes](../../packages/workbench/src/ui/editor-boxes.ts) · [Slice editor](../../packages/workbench/src/ui/slice-editor.tsx)

### Host UI and preference boundaries

Route overlays, clipboard, guide links, and local data through the host
interface. Obsidian uses its native dialogs and menus; the web host
supplies Base UI controls. Anchor a context menu at the pointer, and
an action menu below its control. Interrupting a chooser or confirmation
closes it. Omit host-dependent actions if the host cannot supply them.
Keep device and vault preference scopes separate. Use the editor's
mount for overlays so they open in the correct window.

Return focus to the Fields action when the popup closes unless
insertion has already moved focus into the editor. Let Escape close
field details or clear the search before it closes the popup. In a wide
view the details appear beside their row and count as inside the Fields
popup. Hosts without that overlay use the details bar at every width.
A caret report records whether the reader focused the pane, so a pane
that merely became visible cannot claim the insertion target.

A host tooltip supplies presentation attributes without event handlers.
Use a hidden label for container names in Obsidian because its
`aria-label` also opens a tooltip. Use `aria-label` in the hostless
prerendered skeleton so hydration does not depend on a generated ID.
[Host adapter](../../packages/workbench/src/ui/host.tsx)

Retain a visited pane only while the same occupant remains at its key.
Keep the occupant map stable across unchanged renders so a vacated
row cannot transfer its editor state to a different entry. Return
the original view state for an update with no changed property.
The host assembles Help links from shared guide paths and its own
docs and community locations.
[Visited panes](../../packages/workbench/src/ui/visited.ts) · [Help paths](../../packages/workbench/src/ui/help-pages.ts)

### Obsidian editor styles

Draw Show problem as a focusable link-style control inside the diagnostic
sentence. Override the native unlayered button rules so the control can wrap
with the sentence, including on hover. Restore a focus ring because the
native ring uses the box shadow removed by the inline style. Render plain
text when the preview has no editor to open.

Use native pills for Match chips. Remove the property input's width allowance
and preserve whole words until a word needs to wrap. Keep the compact pill
remove mark. Style the pinned Fields control from its data state in the
unlayered stylesheet because Obsidian's native icon color takes precedence
over layered utilities.

[Native editor styles](../../packages/template-workbench/src/obsidian/editor/theme.css)

## Amendment (2026-11-21): one host

[ADR 0100](0100-the-web-template-workbench-is-retired.md) retired the web Workbench, so the Workbench UI has one host and is no longer headless. It is the unit `src/obsidian/workbench-ui/` of `@zotlit/template-workbench` and draws with its own `zt:` classes. The theme class map, the overlay members of the host adapter (menus, dialogs, suggesters, tooltips, notices) and the host's message supply are gone: the tree opens Obsidian's own overlays directly and reads the plugin's Language Pack. The host adapter keeps only the data ports, and the tests under both React and `preact/compat` are replaced by one Node run of the pure-logic suites.
