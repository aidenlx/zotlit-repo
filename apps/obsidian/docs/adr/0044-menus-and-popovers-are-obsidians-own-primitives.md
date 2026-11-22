# Menus and popovers are Obsidian's own primitives

Every menu and popover ZotLit shows is Obsidian's own `Menu` or popover, built imperatively from presentation data and shown from the gesture that opened it. This holds inside a Preact tree as much as in vanilla DOM: the Annotation View's toolbar, its Attachment picker, and an Annotation card's colour and tag menus each call an action that builds a `Menu`, the same way the card's overflow menu and the pane menu already did.

[ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md) reached the same conclusion for the three surfaces inside Obsidian's PDF reader. This ADR carries it to every remaining surface, so no headless menu or popover library is used anywhere.

One kind of content stands outside that rule: a menu that filters as the user types. `Menu.addItem` takes a label and a callback, so a `Menu` holds no text input and no tickable row. Obsidian's own Bases properties menu is the proof — it builds its own element, its own dismissal and its own keyboard engine, and reaches for `Menu` nowhere. A menu of that kind is hand-built on Obsidian's own popover: `PinnedPopover` (`components/pinned-popover.tsx`) holds a `HoverPopover` open as the Mark Popup does, and Obsidian's `Scope` holds the keys. This is the line ADR 0042 already drew inside the PDF reader, drawn again for content `Menu` cannot express. The Chooser, the Query View's toolbar popovers and its Results menu stand on it.

## Considered Options

- **A headless menu library dressed in Obsidian's classes** (rejected): the popup has to wear Obsidian's `.menu` class to inherit theme chrome, which puts it in a cascade fight with the app's own `.menu` rules. `app.css` sets `.menu { position: fixed; max-height: 100% }` at specificity 0-1-0; a `:where(.zt-menu)` override sits at 0-0-0 and loses. The popup then returns to `position: fixed`, leaves the positioner's flow so the positioner measures 0px tall, and — because the positioner carries a `transform`, making it the containing block — resolves `max-height: 100%` against zero. Measured in a running Obsidian 1.14.2: a 150 × **2** px box, four entries in the DOM, `overflow: hidden` clipping every one. The library also brings a second positioning engine beside Obsidian's, its own dismissal rules, and a portal that has to be told which window it is in.
- **Winning the cascade fight** (rejected): raising the override to `.menu.zt-menu` restores the menu, and was verified to. It leaves ZotLit permanently tracking two `.menu` properties Obsidian may change in any release, and leaves the second positioning engine and portal in place.
- **Obsidian's own `Menu`** (chosen): Obsidian owns placement, viewport clamping, dismissal, theme, chrome, and the window the gesture came from. No override, no portal, no positioner, and one fewer dependency. The Annotation View already renders the same Follow Mode entries into a native `Menu` in `pane-menu.ts`, so the entries were renderer-agnostic before this change.

## Consequences

- `presentation.ts` stays the source of the entries, and the number of renderers over it drops from two to one. A menu is built where the other imperative shell work lives — `actions.tsx` for the Annotation View — and the component calls the action with its own event.
- A menu opened from a control is anchored under the control, by `showMenuAtButton` in [Obsidian Kit](../../../../packages/obsidian-kit/src/menu.ts): `setParentElement(trigger)` plus a `showAtPosition` built from the trigger's rect and its own `doc`. This is what Obsidian's own `ViewHeader.onMoreOptions` does, and every member of it is public API. `showAtMouseEvent` stays for a genuine right-click, such as an Annotation Card's context menu.
- Anchoring to the element rather than the pointer is what makes a keyboard-activated control work: a click synthesised that way carries `clientX`/`clientY` of `0`, which `showAtMouseEvent` reads as the window's top-left corner. `setParentElement` also marks the trigger `has-active-menu` while the menu stands, so a theme can show it pressed.
- Passing the trigger's own `doc` puts the menu in the trigger's window; Obsidian otherwise falls back to `activeDocument`, which is the focused window rather than necessarily that one. A popout host needs no container wiring.
- A native `MenuItem` carries no tooltip, so a blocked entry states its reason in a `setIsLabel(true)` line beside it — `menus.ts` for the Follow Mode's pin, `actions.tsx` for the card's delete. See [tooltip standards](../../policies/tooltips.md).
- A checked entry is `setChecked(true)`, which is the radio semantics the Follow Mode, the Attachment picker, and the colour swatches need.
- `@base-ui/react` leaves the plugin's dependencies, and `components/obsidian/menu.tsx`, its `menu.css`, and `menu-container.tsx` are removed with it. The workspace catalog keeps the entry: `apps/docs` is an ordinary web app and builds its own UI on it.
- The `zt-menu` theme hook is retired: a ZotLit menu is an Obsidian menu, which a theme reaches through `.menu`. The public theme-hooks reference drops its row in the same change.
- The Chooser wears no `.menu` class, so the cascade fight above never starts. It takes Obsidian's menu chrome as variables instead — `--menu-background`, `--menu-border-color`, `--menu-border-width`, `--menu-corner-shape`, `--menu-padding`, `--menu-radius`, `--menu-shadow` — and carries its own theme hooks, one for the popup and one for the trigger, since a theme reaching `.menu` no longer reaches either. The same seven are what the public theme-hooks reference promises and what the End-to-end Run measures the popup against.
- A Chooser steps from its rows to a row's page in the same popup, as a Bases toolbar menu does, and a page's "…" actions open in a `PinnedPopover` rendered in the popup.
- ZotLit uses no HTML popover or top layer in Obsidian. An element in the top layer paints over everything on the body at any z-index, so Obsidian's tooltips, notices, menus and modals fall behind it, and each of those would need a workaround. `PinnedPopover` stays on the body at the menu layer: tooltips stand over it, and it stands over a modal.
- A rendered menu is verified by driving the real Obsidian — `packages/e2e` opens the Follow Mode menu and asserts its entries are inside the popup's own box, which is the assertion the collapsed popup failed.

## Query View controls

Use a toolbar container query to hide labels as space decreases. Retain the view switcher's label and the result count. On the narrowest toolbar, hide the switcher's icon to make room for the other controls. Keep disabled triggers in the tab order so their tooltip can explain the reason. Use the focusable Bases-style grip for drag reordering and Alt+Arrow Up or Down for keyboard reordering.

Draw toolbar controls from Obsidian's button variables and popovers from its menu variables. Use an unlayered rule with `revert-layer` to give toolbar utilities control of native buttons. Use the same rule for popover action rows so they can look like menu entries. Let popover sections own their padding and put scrolling inside the surface so an editor's tooltip can extend past its edge.

The Table column menu exposes drag moves and the double-click width reset as menu actions. Interpret left and right as physical directions, including in a right-to-left interface. Keep unavailable edge moves visible and disabled. Exclude actions that do not apply and omit empty sections. A column's Edit Property action opens the same Property page as the toolbar, anchored to the header without a parent page. Close it if the column leaves the header. Keep one Property page open at a time. Read the current view when each menu action runs because a save can change it while the menu is open.

Use the same field layout in Sort and Group. An empty setting shows a property placeholder. The direction the researcher picks there applies to the first property. Join the property and direction selects in a single field with a shared focus ring. Show the saved Display Name for an unavailable property and mark it as unused so the researcher can see the setting still exists. Clear the host checkbox margin on Manual group rows so spacing follows the layout.

Keep Properties rows in place while the researcher checks and clears them. Resort on search, reorder, Hide All, or return from a page. Keep a hidden Property's page open until its subject leaves the file. Show paths beside duplicate names and match searches against both names and paths. Use the row for both selection and its accessible state so the checkbox leaves focus in the search field. The view switcher pins Add View under its scrollable list and opens Configure View for the selected row through the chevron, Arrow Right, or context menu.

Use a PinnedPopover directly for Results so the numeric input gets native arrow-key and Enter behavior. Keep the Show All entry in place when unavailable so typing a limit does not move the other actions. The count reflects the visible snapshot, including when the latest query failed and retained its previous rows. Only a researcher-set limit marks the trigger as active.

For Property reordering, drop after the target when moving down and before it when moving up. Move the highlighted visible Property with Alt+Arrow Up or Down, and leave page fields in control of their own keys. Use Obsidian's type icon for each Vault Property and show a broken Formula's diagnostic on its icon. The view switcher gives up width before the other toolbar controls. Mark the current view with medium-weight text, and open its Configure View page from the trigger's context menu.

The toolbar and sidebar use the same Match editor for Query View filters. Draw the toolbar version at the menu layer. Use browser suggestions for value fields because Obsidian's suggestions draw below that layer. Apply the Query View's field and button styles without changing Template Workbench's Match theme. Start with populated filter sections open so active conditions are visible. Keep folded editors mounted.

The Annotation Card menu sets up its own entries before it calls extension listeners. Its colour submenu raises a separate event. Both events carry the full set of Annotations the action will affect. [Card actions tests](../../../../packages/annotations/src/desktop/annot-view/actions.test.ts)

Keep header menu decisions in the presentation function and build the resulting groups as native Obsidian entries at the event that opened the menu. Use `setIsLabel` for reports so users can read them while the arrow keys skip them. The pane menu adds the header entries without a section because Obsidian separates those entries from its own sections. [Header menu](../../../../packages/annotations/src/desktop/annot-view/menus.ts) · [Pane menu](../../../../packages/annotations/src/desktop/annot-view/pane-menu.ts)

The Annotation View header reports its state inside a single press target for the header menu. Use a hidden label referenced by `aria-labelledby` so Obsidian does not put the sentence in a tooltip. The pane's More options button is inside a wrapper that appears in the side dock, where Obsidian hides the view header. The wrapper controls visibility because Obsidian's icon button sets its own display. [Annotation View header](../../../../packages/annotations/src/desktop/annot-view/AnnotView.tsx)

Read the current view state when building a native menu. Anchor menus opened by a control to that control and place a card's right-click menu at the pointer. Both entry points use the same selection and menu contents. The group menu exposes actions that apply to every Selected Card and marks a swatch only when they share that colour. A blocked colour submenu stays closed. Delete and Edit quoted text stay pressable when the capability blocks them so the press can show a reason. While a write disables a verb, the menu dims that verb. Copy remains available when any selected record has text to copy.

Write the clipboard through the platform API first. If an awaited read causes the platform to refuse the write, the desktop host falls back to Electron's clipboard. [Card menus](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

## Annotation field editor Scope and menu

Push an Obsidian Scope while the embedded CodeMirror field has focus. Obsidian's editor hotkeys otherwise go to `workspace.activeEditor`, which can still be the Markdown note behind the card. Use the user's bold and italic bindings for Zotero formatting. Stop further Obsidian lookup for other registered editor hotkeys and leave their DOM events for CodeMirror. Commands that do not act on an editor, including mobile toolbar actions, keep their normal app keys. Normalize stored physical letter keys before registering them. The host behavior is in Obsidian 1.14.2's `Commands.addCommand` and `HotkeyManager.onTrigger`.

Use the native editor menu pattern with the four supported formats and clipboard actions. Raise the editor menu event with the surface and CodeMirror view. Parent the menu to the editor so interactions in it stay within the editing surface. For a keyboard context menu without pointer coordinates, position it at the caret in the editor's own document. Menu focus transfer is not a departure from the editor. Restore focus on dismiss. [Field editor](../../../../packages/annotations/src/obsidian/annot-view/field-editor.ts)

## Pinned surface placement and lifetime

Use Obsidian's popover shell for interactive content that cannot fit in a Menu. Its native stack and anchor document determine how tooltips, notices, and menus overlap it. The caller styles only the content. Default placement follows the anchor. Inset placement fills its box with the native gap token. Beside placement chooses the roomier side, clamps to the supplied view bounds or window, and can overlap the given box when neither side fits. Reposition on size and scroll changes. Use an independent resize observer for filtered content because Obsidian's observer stops after ten callbacks.

Mount the content on first open and keep it between openings in the same document. Remount it after an anchor moves to another window because editor state belongs to a document. Register layout-effect cleanup so a popup opened and unmounted in one frame still closes. Count nested popovers and Obsidian floating controls as inside. Leave anchor presses to their own toggle. Focus the shell on open unless the caller opts out. On dismissal restore focus when the popup held it. After an outside press, let the browser focus the pressed element and restore the anchor only if focus ends on the body.

A targetless popover chooses its owner document independently of the current focus. On Obsidian 1.15.1, native placement uses `activeDocument` each time, so temporarily use the owner document for that call. A targeted popover uses the target's document. Cancel the native show timer on the main window and show immediately when needed. On that version, the click following a pointer release dismisses a popup whose show delay is still armed. [Pinned popover](../../../../packages/obsidian-kit/src/components/pinned-popover.tsx) · [Native popover adapter](../../../../packages/obsidian-kit/src/hover-popover.ts)

## Focus and drag scopes

Let an inner surface hold its own Obsidian Scope while focused. The enclosing surface pushes its scope during focus capture, so the inner surface can push after it. Release on blur, migration, or disposal. Reacquire on focus in the current window. A pinned popup leaves composing Escape to the input method and lets content handle an ordinary Escape before dismissal. A keyed registration for the popup's page keys stops Obsidian lookup while leaving the DOM event available.

Capture a resize pointer and track its axis across the window. Coalesce updates by animation frame. On release use the last measured displacement and cancel any scheduled frame. A press with no movement emits no drop. End on cancellation, pointer loss, a view abort, or Escape. Hold Escape in the drag's Scope so it cannot also change the underlying view selection. [Focus scope](../../../../packages/obsidian-kit/src/focus-scope.ts) · [Pointer drag](../../../../packages/obsidian-kit/src/pointer-drag.ts)

Use Obsidian's scrolling dialog body with a pinned title and footer. The wide variant uses the community-browser width for a form and preview that stack when space runs out. Nested labels associate with their controls, and the footer takes native action order. [Dialog frame](../../../../packages/obsidian-kit/src/dialog-frame.ts)

The scope test also covers an enclosing surface whose focus handler does not push its Scope when focus enters the inner field.

## Chooser rows and search

Keep query filtering, selection and highlighting in the pure Chooser logic module. The Annotation View can use the same ordered tick operation outside React without loading the component graph. Pass the fuzzy matcher in so the logic stays host-free. Match labels without ranking by score, match hidden Search Terms by their stricter rule, and keep the original group key as other groups disappear. A group with no surviving rows loses its label and separator. Action rows survive the query but do not count as matches. The list owns the group data and optional empty message because it knows the surviving rows. Place that message beside the options in an already mounted live region outside the listbox. Pinned groups share the same navigation sequence.

The caller owns a selection of string values. A tick appends or removes a value without reordering the others. Enter and click share row activation, including the disabled state. A tick stays open. An action can close through its supplied callback and otherwise stays open. Use one row shell, with separate item and action content, to share click behavior and listbox semantics. Keep the leading glyph column aligned and use a styled check with `aria-selected` instead of a nested focusable checkbox. An action needs its own glyph to read as a command. [Chooser logic](../../../../packages/obsidian-kit/src/components/chooser-logic.ts)

## Chooser focus and navigation

Mount a fresh session on each open. Start with no highlighted row unless an opener supplies a query. Do not move the highlight on hover. Click and navigation move it, and typing moves it to the first match. Preserve its row identity on rebuild when the row survives. Step arrows wrap, page steps clamp, and Home and End jump to their respective ends. Without a highlight, Down starts at the first row and Up starts at the last. Measure a page from today's scroll box and row height, using at least one row for a page step. Let Ctrl+P and Ctrl+N follow the arrow semantics. ArrowRight opens the highlighted row's page when available, otherwise it can move the input caret.

The session alone resolves the highlight against the published rows. Give DOM focus to the search combobox or, when absent, to the listbox itself. The focused element names the row with `aria-activedescendant`. Name the listbox and its groups with their headings or hidden labels. Headings have no option identity. Keep the search input as text so a native search control does not swallow Escape to clear itself.

Push the session Scope for one open. Use layout effects so the rows and Scope are committed before native key dispatch, and let installed handlers read a ref updated in the current render. Consume navigation and activation for the option list even when there is nothing to select. Yield IME composition and let page fields handle their input. Keep field undo and redo native and stop propagation at the popup edge so app surfaces outside cannot act on it. [Chooser component](../../../../packages/obsidian-kit/src/components/chooser.tsx)

## Chooser pages and appearance

A page covers the rows without losing their highlight. Open a page or initial query from the trigger, and return focus to the list or search when stepping back. A pages-only popup closes on return from its first page. Focus and select the first field after the child's layout effects, or focus the page when it has no field. Enter in a text field moves focus to the page, saving on blur, and requests form submission. Recheck pending text on page disposal because DOM removal need not fire blur. Read the latest input event for a save that arrives before its render. An inner page menu or editor popup pushes its own Scope so it receives Escape first.

Keep a blocked trigger focusable and give it a reason tooltip. Expose open state to the trigger's own content. Use a native button for a popover invoker and utility styling for chip-like triggers and back controls. Reset Obsidian's unlayered button and search styles where they would override the Chooser design, and take menu sizing and colors from theme tokens with divider fallbacks. Leave the root unclipped for nested menus and tooltips. Let the rows and pages scroll in their own boxes. Keep the anchor's menu chrome separate from the flat search field. Inline field labels use `aria-labelledby` to avoid duplicate activation and cascading tooltips. [Chooser styles](../../../../packages/obsidian-kit/src/components/chooser.css)

### Single-value selection and compact controls

Use a Chooser for the single-value Select. Selecting the current option keeps the value and closes the popup. Match raw IDs and Search Terms as well as the label. Put the option glyph before its name and the tick after it, and hide details that repeat the name. Use the placeholder for an empty value and display an unknown saved value as-is. Read native dropdown variables so a containing filter or sort control can adjust the chrome.

From the trigger, either vertical arrow opens the list and a printable key opens it with that query. Tab or Shift+Tab out closes it so its Scope cannot hold keys from the newly focused control. Let a trigger press close through the normal toggle instead of closing on the press's focus transfer. Name the list after the field without adding a hover tooltip over its rows. [Select](../../../../packages/obsidian-kit/src/components/select.tsx) · [Bases combobox notes](../bases-toolbar-menu.md#comboboxes)

Use Obsidian's flat clickable-icon surface for compact selection controls. Override the native unlayered whitespace, font and alignment rules only where required. Draw borders in the same layer because the native button reset outranks utility divides. Draw a clipped row's focus ring inside its outline. Keep blocked controls focusable with their reason tooltip. An invisible icon-button spacer aligns rows that omit the action.

Use Obsidian's paired icon size and stroke variables. For a custom length keep the surrounding stroke. Reuse the host icon's exact classes so a bare icon name cannot collide with a host class such as `external-link`. Copy a fresh SVG clone into the managed node and remove copied attributes left by a different icon while React keeps class ownership. Align a leading icon to the first line of a multiline label. On a slider, draw fill from the current value and use the dynamic tooltip path when the value should replace the accessible label. [Icons](../../../../packages/obsidian-kit/src/components/obsidian/icon.tsx) · [Selection styles](../../../../packages/obsidian-kit/src/components/obsidian/selection-control.css)

## Native Menu anchors and extension events

Place a native Menu at the bottom of its trigger and let Obsidian add its
two-pixel gap. Align a right-side control to its end so the menu grows inward.
A live trigger gets the native active-menu mark for theme styling, dismissal
when the trigger disappears, and toggle behavior on a second press. A menu
hangs off the document body, so an enclosing surface looks for that mark on its
own controls to identify its open menu. For an async file-menu action, capture
the rectangle and document during event dispatch because `currentTarget` is
cleared after the callback yields. A captured anchor does not attach a trigger.
[Menu anchors](../../../../packages/obsidian-kit/src/menu.ts)

The owning feature declares a menu's payload by merging `ZotLitMenuEvents`.
Use one section list for the feature's entries and the native display order.
The empty string identifies the unnamed section, and the danger section holds
irreversible actions. Add the feature's own entries, register the section
order, and then raise the workspace event before showing the Menu. Listeners
add to that same Menu synchronously so entries appear in their named sections.
An entry's click handler can run asynchronous work. [Menu extension events](../../../../packages/obsidian-kit/src/menu-events.ts) · [Annotation View example](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

## Obsidian keymap fixture

Mirror Obsidian's Scope lookup in tests. A null modifier list matches any
modifiers, and an empty list matches a bare key. Try registrations in order.
A keyed or modifier-specific match ends lookup even if it returns undefined.
An undefined response from a catch-all permits further lookup, including the
parent Scope. Only false consumes DOM delivery. Give the Scope the focused
event target before dispatching to the page. This models the lookup and DOM
delivery separately, as in Obsidian's `Scope.handleKey`. [Keymap fixture](../../../../packages/obsidian-kit/src/__fixtures__/keymap.ts)

The comment editor fixture records the pushed Scopes in a DOM test. It omits
editor commands so the case can isolate the editor's own bindings. The submit
helper reads the mock's registered handlers because Obsidian's public Scope
type does not expose them. [Editor fixture](../../../../packages/obsidian-kit/src/__fixtures__/editor-app.ts)

## Shared sidebar layout

Use the native empty-pane pattern for an empty or error state. Center it in
the space below the toolbar and let it take its content height when the parent
has no set height, as in a Query View embedded in a note. Taller content
scrolls from its top. Keep the frame unnamed so the state inside supplies its
own accessible name. Share toolbar padding and the native header's centered,
wrapping action group. Let each view supply its own container queries, wrapping
rules, and trailing controls. [Pane state](../../../../packages/obsidian-kit/src/components/pane-state.tsx) · [Sidebar toolbar](../../../../packages/obsidian-kit/src/components/sidebar-toolbar.tsx)

Supply App Context when mounting a view that uses shared controls. Their
Scopes need the App's parent Scope and keymap, which the rendered element
cannot provide. Fail at render without the context so missing keyboard
behavior is visible during development. Bind a ResizeObserver to the window
that owns the elements it watches. Rebind on window migration, and allow a
test window to omit the observer. [App Context](../../../../packages/obsidian-kit/src/app-context.ts) · [Resize observer](../../../../packages/obsidian-kit/src/observe-resize.ts)

Use tooltip attributes when Obsidian's delegated pointer listener can supply
the native tooltip without a ref effect. Share a structural keyboard event
between React and native listeners for Enter and Space activation. For
nested native menu controls, mark a handled click by its DOM event so an
ancestor can stand down while the window still receives the event and can
dismiss the menu. [Control helpers](../../../../packages/obsidian-kit/src/utils.ts)

## Native control contracts

Use a text input inside a popup when Escape should dismiss the surface on its
first press. A search input clears its text first and keeps that key. Both
use the native styling and the component's own clear affordance. Give a
Toggle its visible label's ID to avoid the hover tooltip that Obsidian adds
for an aria-label. A Color control's value is a hex string.
[Control wrappers](../../../../packages/obsidian-kit/src/components/obsidian)

Obsidian's Menu pushes a Scope after placement and pops it on hide. It takes
the arrows and Enter. Escape hides the Menu and continues through dispatch.
Use the native submenu method to get the child Menu. Suggestion popups put
their element on the document body and may expose a chooser. Selection
index minus one clears that chooser's highlight. The editor suggest API can
activate its highlighted item as Enter would. The hover popover's focused
flag keeps a targetless popup open. Its native show callback places it before
claiming the parent and loading. Placement uses inline top or bottom style,
and native resize triggers placement again. A static point overrides the
target's boxes and null restores target-based placement.

The native stack exposes registered hover sources for Page preview settings.
Core editor commands target the active editor and include mobile toolbar
commands. A physical hotkey uses its stored code, and the user's hotkey may
be absent when there was no customization. The host supplies the display
text and controls whether a button displays it. [Host control declarations](../../../../packages/obsidian-kit/src/typings/obsidian-ex.d.ts)

### Native popup behavior in tests

Model the main-window wait timer and global click cancellation of a pending
popover. Run the native opening sequence so subclasses can exercise placement
and teardown. Resolve the placement document from the target or the active
document on every call. Tests supply geometry when needed because the mock
does not compute layout or observe the last pointer position. Use the active
window when opening a modal.

Input suggestions react to focused input and close on blur. The popup puts its
own Scope ahead of the field, handles arrows, Enter, and Escape, and gives
custom registrations a turn after the native ones. A test can omit the
private chooser to model Obsidian builds without it. Record Scope registrations
for tests that need to drive key handlers.

Record Menu items in insertion order and omit separator rows. Assert the
declared section on an item to check grouping, because the mock does not run
the native sorting pass. Load the Menu on a later timer, push its Scope on the
test keymap, and pop it on unload. Escape closes and unloads the Menu, then
continues through dispatch. Invoke the hide callback, and ignore clicks on
disabled items. [Popup mocks](../../../../packages/obsidian-kit/src/__mocks__/obsidian.ts)

### Native shell and retargeting

Reset chrome on the unlayered native popover shell so the inner Pinned
Popover can supply its own styles. Give both the shell and its body
content-driven width so Obsidian's fixed-width note-preview child rule does
not apply. Let native placement move the popup back on screen. Keep
overflow visible so tooltips can draw past the surface, and put the shell
at the menu layer over modals. [Pinned Popover styles](../../../../packages/obsidian-kit/src/components/pinned-popover.css)

Move both bound mouse listeners when retargeting the same native popover.
Use the native transition to restore a hiding popup and clear its hide timer.
A still-opening popup retains its enter timer. Consumers update the content
and place it again after each swap because the native resize watcher stops
after ten callbacks. The timer fixture gives each window its own timer
handles so clearing on the wrong window cannot pass by accident.
[Singleton popover](../../../../packages/obsidian-kit/src/singleton-hover-popover.ts) · [Timer fixture](../../../../packages/obsidian-kit/src/hover-popover.test.ts)

## Item picker opening and selection

Keep the picker and its backdrop transparent while it waits for the first
answer so the first frame can include rows. Keep focus in the input. After
100 ms, show a loading row while waiting. Use the owning window's timer and
start the gate before the native open callback requests suggestions.

Obsidian can leave old rows visible while a new answer is pending. Mark the
list busy. Drop clicks on those rows, and let Enter wait and choose the first
row of the current answer. Give the modal an Enter handler above the list's
Scope so Enter works before any rows exist. Leave IME composition and other
keys to the native controls. If another query supersedes a waiting answer,
follow the new one. Closing cancels the pending choice. Distinguish Items with
the same title by Indexed Key. Native SuggestModal closes before reporting a
choice, so suppress the dismiss value on that path.
[Item picker](../../../../packages/plugin-services/src/obsidian/item-lookup/search-modal.ts) · [Current answer](../../../../packages/plugin-services/src/obsidian/item-lookup/current-answer.ts) · [First answer](../../../../packages/plugin-services/src/core/item-lookup/first-answer.ts)

## File menus and Indexed Keys

Use one native `file-menu` listener for the explorer, tab header, view, and
link menus. Resolve shared context once per menu. Only a view's own menus
supply its leaf. Feature segments add entries synchronously in the native
menu construction tick. Their actions can await work. Section controls
grouping and the registered order controls placement within a section.
Folder menus run only folder segments.

The Literature Note, Annotation View, and Template Data Explorer use one
action to copy an Indexed Key. Set a section for its menu entry only on menus
that group by section. Obsidian sorts sectioned entries first, so an
unsectioned menu needs this entry to remain unsectioned to preserve the
placement intended by the caller.
[File menu](../../../../packages/plugin-services/src/obsidian/file-menu.ts) · [Indexed Key menu](../../../../packages/plugin-services/src/obsidian/indexed-key/menu.ts)

## Host sections and pane dividers

Obsidian registers section order before plugin entries arrive. Use its registered section names for file menus, tab header menus, and view menus so actions stay with their peers. An unregistered section falls below Delete. The file explorer has no pane section. Put creation actions beside the native creation actions and apply the warning treatment to destructive entries. This ordering was checked on Obsidian 1.14.4 against the file context menu, tab header menu, and view header menu.

Use Obsidian's divider variables for the shared pane divider. Its wide target extends over the pane and leaves only the narrow visible border in the layout. The overlay form is positioned within the pane. The inline form reaches back over the preceding pane with a logical negative margin derived from the two widths. Hover and focus show the divider hover color. An active drag holds the accent once the pointer leaves the target. The drag state comes from the active class or the rendering surface's dragging attribute.

The Template Data Explorer uses native menu sections so its pane actions
remain alongside Obsidian's entries.

[Explorer actions test](../../../../packages/template-workbench/src/obsidian/data-explorer/actions.test.ts)

### Tag Chooser chrome proof

Find the tag trigger by its label because the color Chooser can
precede it. In running Obsidian, check that the native popover
contains its rows and leaves the document when closed. The popup
has no menu class. Compare computed styles with a temporary sibling
that reads the native menu variables, and verify that the sibling
does not fall back to initial values. Read padding from the list
box because the search field spans the popup. Compare the shadow
suffix because Tailwind prepends transparent ring and inset
components. This checks the theme contract and the closed-state
behavior with Obsidian's actual styles.

[Tag Chooser case](../../../../packages/e2e/src/annotations.e2e.ts)

### Query Filter tooltip proof

Move the pointer before hovering so Obsidian observes a move.
A tooltip can outlive a removed button until pointer release.
Enable pointer hit testing for the sampled tooltip to check what
paints at that point. Near a window edge, Obsidian shifts the
tooltip inside the window, so the check looks for overlap with
the trigger.

[Filter tooltip case](../../../../packages/e2e/src/query-view-filter.e2e.ts)

Apply the Query Filter tooltip probe to the Properties popover as
well. Test the real hover after pointer motion, and enable hit
testing on the sampled tooltip to identify the painted surface.

[Properties tooltip case](../../../../packages/e2e/src/query-view-properties.e2e.ts)

### Query View surface proof

Compare one wide and one narrow Query File pane. Wait three stable
frames for sidebar collapse before testing the responsive toolbar.
Retain tooltips on icon-only controls. A child of the popup's own
surface can paint past its edge and still be the topmost hit. Check
the toolbar popover and the Property chooser entry point. In a
menu with a nested page and page menu, Escape closes the menu first,
then returns to the rows while keeping the outer popup open.

[Toolbar and popup cases](../../../../packages/e2e/src/query-view.e2e.ts)
