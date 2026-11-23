---
status: accepted
---

# Graph Citations extend Obsidian's graph through a per-render metadata facade

Graph Citations add citation edges and Cited Work Nodes to Obsidian's own global and local graph views instead of shipping a separate ZotLit graph view. For each live graph leaf, ZotLit wraps the engine's render call and, for that one synchronous call, gives the engine a metadata-cache facade whose resolved and unresolved link maps carry the citation edges from the Citation Index. The engine's own narrowing, orphan sweep, "Existing files only" row, search, groups, hover highlight, and active-note following then apply to citation edges unchanged. A second wrapper on the renderer's data hand-off colors Cited Work Nodes that carry no user group color. Cited Work Node callbacks provide citation-specific actions, including creating a Literature Note. Existing file nodes keep native colors and interactions unless the user selects a graph control or color group.

The facade lives only inside one render call on one engine instance. Nothing else in the application observes it, which is what separates this from patching the app-wide metadata cache.

## Considered options

- A separate ZotLit graph view with a captured renderer class keeps every native control (search, groups, depth, following) to be rebuilt, and asks researchers to learn a second graph.
- Wrapping only the renderer's data hand-off runs after local narrowing, so depth and direction in the local graph never traverse a citation edge and the orphan sweep ignores them.
- Patching the app-wide metadata cache reaches every consumer of links (backlinks, search, publish) and cannot be scoped to one view.

## Consequences

- Every touched surface is undocumented Obsidian runtime behaviour verified against 1.13.4; the wrapper must guard each access, degrade to a message when the Graph core plugin is unavailable, and be re-verified when the minimum app version moves.
- The render wrapper depends on the engine reading its app reference once at the top of render; the edge tint proxy depends on the link sprite lifecycle. The Work Label wrapper also depends on the node text sprite lifecycle: `initGraphics` builds text lazily, `clearGraphics` destroys it, and render assigns its style on font changes. Also verify the renderer's `fTextShowMult` text-fade term: native opacity is `clamp(log2(scale) + 1 - fTextShowMult, 0, 1)`, and the title fades over the following octave. An absent or nonfinite fade term logs a warning and uses zero. Verify `getHighlightNode()` and the visible container's `updateTransform` hook, which updates title alpha before child transforms. These are the re-verification points.
- Each graph view owns its selected options. Citation Graph commands apply their preset to the target view; separately opened ordinary graphs start from ordinary defaults. View restoration preserves each graph’s options; native bookmarks capture and restore global graph options. This requires isolation from Obsidian's shared global graph options.

## Native defaults and explicit presentation choices

"Show citations in graph view" remains enabled by default. It adds citation connections to Literature Notes and Cited Work Nodes to both global and local graphs. "Existing files only" hides Cited Work Nodes. Turning the feature off removes the added connections, nodes, and controls; native groups and other explicit native settings remain user-owned.

Ordinary graphs use native styles for existing notes and links. Added connections participate in native layout, local depth, orphan filtering, and neighbor highlighting, so the resulting node positions and membership can change. Cited Work Nodes retain their citation-specific actions and muted default color.

"Color citation links" and "Citation popover" are independent per-view controls, both off by default. The link-color control applies to citation connections, including existing wikilinks classified as citations. With the popover control off, existing file nodes use native hover. Enabling it opts that view into citation popovers. ZotLit's graph controls remain available while Graph Citations is enabled.

Both choices persist with the global or local graph view. Reopening a saved view restores its choices. Native global graph bookmarks capture and restore both choices. A separately opened ordinary graph starts with both controls off, even after a Citation Graph shortcut was used elsewhere.

## Literature Notes Group and shortcut

Literature Note colors belong to ordinary graph color groups. The Citation Graph shortcuts enable link coloring and citation popovers and add the Literature Notes Group. They retain the citation-focused preset: citation-connected nodes, admitted citation sources enabled, arrows on, tags and attachments hidden, orphans hidden, and Cited Work Nodes visible.

The public `--zt-graph-literature-note-color` theme variable sets the initial color of a new Literature Notes Group. Its low-specificity defaults use ZotLit orange from the brand palette referenced by `apps/docs/DESIGN.md`: `#E8622C` in light mode and `#F0793F` in dark mode. The group takes the current theme's starting color at creation, then keeps its saved color across theme changes. Native controls own its color, order, and removal.

An existing matching group keeps its color and position. A new group is appended after existing groups. Removing it returns color control to the remaining native groups and native node styles. Running the shortcut again adds the group if it is absent. The separate "Add literature notes group" action uses the same rules.

These choices make group removal effective and keep citation presentation under explicit user control. They replace the earlier automatic Literature Note coloring and shared global preset persistence decisions.

## Citation edges and surviving nodes

Use the Document Citation Set's admitted occurrences. An aliased Wikilink, a heading or block link, and a malformed Citation Fragment keep their native meaning. A Wikilink Citation already has a native edge. When its graph row is off, subtract only admitted occurrences from the native count so an ordinary link to the same target survives. When the vault excludes Wikilink Citations, omit the row and leave native links in place.

For a uniquely resolved literal citekey with Literature Notes, use a note already linked from the source or the first in Note Index order. Add one edge when the current render has no surviving native edge to that note. Track the connection as a citation edge even when the native link already draws it. A missing, ambiguous, pending, or noteless citekey gets a Cited Work Node. Use the typed `@` form as its label and use a division slash for an embedded slash because the host displays the suffix after the last path separator. Give each Cited Work Node a `zotlit#cited-work/` ID prefix so the native graph keeps it separate from ordinary unresolved Wikilinks: the host cuts unresolved link text at the first `#`, tag IDs start with `#`, and file IDs are vault paths with an extension. [Graph adapter](../../../../packages/citations/src/obsidian/graph-citations/adapter.ts)

In Citation-connected only mode, retain Literature Notes and notes that reach a visible citation edge. Let unresolved targets supply Cited Work Nodes. Filter both link maps as well as the cached file list because Obsidian 1.14.1 can introduce unresolved nodes in the render scan and reintroduce file targets during local depth expansion. Suppress tag nodes at the cache read during that render so the original Tags setting applies again when the row is off. Bind forwarded methods to the original cache or app so they read the correct receiver state. Restore the original app in a finally block. [Render facade](../../../../packages/citations/src/obsidian/graph-citations/facade.ts)

## Host member checks

Read the global engine from `dataEngine` and the local engine from `engine`. Defer installation until the real leaf replaces its placeholder. Check that the engine has a `hoverPopover` member because the host initializes its value to null. Check the renderer's node lookup, scale, and offsets when installing because the constructor initializes these values. A missing member leaves the affected view or optional surface native. Keep optional probe failures per engine and per surface in a weak map so repeated reads of that engine do not repeat the warning or disable other surfaces. [Member checks](../../../../packages/citations/src/obsidian/graph-citations/install.ts)

## Installation lifetime and update order

Read saved local graph options before layout-ready because a host save before ZotLit's rows exist can drop their keys. Capture options from deferred leaves for installation after load. When the host creates a live view, install its controls before `load` and `setState` so native bookmarks can restore their values. Install controls before applying the Citation Graph preset because the native panel accepts only the keys its rows know. A vault-wide Wikilink Citations change replaces the filter rows in each view while its render facade and node callbacks stay installed.

Own each installation with its view and key the live registry by renderer. Attach the wrappers and register the installation without an Effect suspension between those operations. Release it on view close, feature disable, or layer unload. Closing a view must stop the hover hold because the closed leaf leaves the workspace listing and Obsidian does not necessarily dispatch node unhover. Release the captured uninstall callback when the feature is disabled because Obsidian keeps registered callbacks until unload. On layer unload, stop new work, cancel queued renders and label reads, and then restore the native members. Release the shared Citation Lookup observation after the last installation ends.

Compute additions inside the host's synchronous render and retain that render's result for node callbacks. Keep the observed Citation Lookup answer available synchronously. Collect Wikilink occurrences only when the vault setting admits them because reading them walks the host link cache. Coalesce index events for 150 ms because backfill can emit a change for every file. Keep the scheduling callback untraced on that path. A theme change invalidates the shared colours and requests another hand-off because existing nodes keep the colour they received.

Read Work Labels only for drawn nodes and outside the synchronous data hand-off and animation frame. Share held results by Indexed Key, retain existing labels while replacement reads run, and keep failed or missing labels native where there is no held value. Draw labels only for items within Library Scope. Keep the settled render and label publication uninterruptible because a callback inside either can start the work that replaces its own fiber. [Graph Citations service](../../../../packages/citations/src/obsidian/graph-citations/service.ts)

## Graph hover anchors

Use the last render's Cited Work Nodes and the Literature Note metadata to determine which hovered nodes name a work. Leave other nodes on the native hover path. Honor the view's Citation Popover option and current Hover Action, and require a mouse and Mod where configured. Leave the hover native if the renderer provides no position. Page preview needs a file, so use it only for Literature Notes. Send the full vault path through the shared citekey hover source with an empty source path.

Put a zero-size, pointer-transparent anchor in the graph's own container because the canvas has no element for a node. Convert renderer coordinates to container CSS pixels with its scale, pan, and window pixel ratio. Give each new hover an anchor. Obsidian 1.14.1 treats a Page preview request for its current target element as the same preview. Retain an old anchor while a popover still uses it for positioning. When a render drops a node or the view disables citation hover, retire the affected anchors and popovers.

Obsidian's pointer sweep clears `onTarget` because the anchor leaves hit testing to the canvas. State `onTarget` and ask the host to transition every 200 ms until unhover or hide. Allow up to two seconds for the opening delay. Clear the timer through the window that created it because the graph can move to another window. Refresh only the popover that targets the hovered node's anchor. [Graph hover](../../../../packages/citations/src/obsidian/graph-citations/hover.ts)

## Native graph controls and colors

Append ZotLit's citation filters to the native Filters section. Put its Display rows before the native rows because Obsidian 1.14.1 hides the last row's label for Animate. Read defaults when a section is unavailable or its rows have yet to set options. Match the Literature Notes Group with Obsidian's property-existence query and quote `zotero-key` to preserve the hyphen. Insert through the native options path so the group can be saved and edited. Reattach the same button after a group settings change, drag reorder, or reset rebuilds the section. The native add and delete controls update only the rows. [Display rows](../../../../packages/citations/src/obsidian/graph-citations/display.ts) · [Filters](../../../../packages/citations/src/obsidian/graph-citations/filters.ts) · [Groups](../../../../packages/citations/src/obsidian/graph-citations/groups.ts)

Resolve graph theme colors on a temporary element under `body` with the color value on the element. A graph already open at plugin startup can draw before Obsidian loads the plugin stylesheet. Share computed node and link colors across graph views until a CSS change. Capture the Literature Notes Group color on insertion and leave the group's saved color under native control. Keep native group colors on Cited Work Nodes that already have a color. For other Cited Work Nodes, use the theme property or the host's faint text color. For citation links, use the theme property or the host's purple. Read ordinary RGB channels directly, use a single canvas pixel to resolve other CSS color syntax, and combine the alpha with computed opacity. A rejected canvas fill assignment keeps its previous value, which the reader uses to detect an invalid color. [Theme colors](../../../../packages/citations/src/obsidian/graph-citations/node-color.ts)

Tint the host's line sprite because the edge data has no color field. Keep the native tint on edges incident to the highlighted node. Obsidian 1.14.1 draws one line for reciprocal links, so tint the visible line if its reverse is a citation and both directions are present in the render. A local graph may contain only the ordinary direction, which keeps its native color. Follow the sprite through lazy graphics creation and rebuilds, and preserve its identity and native tint setter. Refresh tint handlers after each data hand-off. Request a frame on color or classification change and on teardown because native data hand-off can skip repainting when the topology stays the same. [Citation link colors](../../../../packages/citations/src/obsidian/graph-citations/link-color.ts)

## Graph options and bookmark restoration

Use the host's option-listener protocol to read and write each toggle under its `zotlit-` key. The host reads the listener without an argument when saving options and passes a value when restoring them. On change, record the live option, render, and request persistence. Wrap the section's default reset because the native reset supplies only native keys. Remove each plugin listener and row during disposal, and retain the live option for reinstallation. Initialize from a boolean live option, a boolean saved option, or the row default in that order. Retrieve options for loaded leaves from the serialized workspace, including nested splits, and for deferred leaves from the placeholder's saved state. [Toggle rows](../../../../packages/citations/src/obsidian/graph-citations/rows.ts) · [Saved options](../../../../packages/citations/src/obsidian/graph-citations/saved-options.ts)

Use the native per-leaf state for a local graph. For a global graph, write a copy of its options to the view state and request a layout save when they change. This keeps one graph's groups and filters out of another graph's defaults. Reset the legacy citation options after native load, then apply the saved view state. Restore each saved Display and Filter option and use its row default when an older bookmark omits it. [Global view state](../../../../packages/citations/src/obsidian/graph-citations/view-state.ts)

Apply the Citation Graph preset through the native set-options path so existing listeners own each change, render, and save. A section handles only its registered keys. Omit the Wikilink Citation option when the vault excludes the syntax. Obsidian 1.14.1 has no local Orphans toggle, so a local graph ignores that preset key. Leave forces and other options outside the preset so the view can keep those settings. [Preset](../../../../packages/citations/src/obsidian/graph-citations/preset.ts)

Model the native option listener and default reset rules in the graph fixtures. The Groups double rebuilds the section body on `setColorQueries` so a test can exercise the button being detached and reattached. The theme fixture sets properties on `body` to reproduce inheritance into the probe. [Controls fixtures](../../../../packages/citations/src/__fixtures__/graph-citations/test-double.ts) · [Theme fixture](../../../../packages/citations/src/__fixtures__/graph-citations/test-stub.ts)

## Graph commands and node actions

Use Obsidian's modifier-to-pane mapping for the global command. Offer the local command when a note is active and open its graph in a vertical split. Capture the most recent leaf before splitting because the new leaf must follow the original pane's file. Apply the preset after the graph view loads. If the Graph core plugin or Graph Citations is off, show the reason and leave the workspace as it is. [Commands](../../../../packages/citations/src/obsidian/graph-citations/actions.ts)

Route a Cited Work Node click through Citekey Navigation because the native action would use the virtual ID as link text and could create an empty note. The native right-click menu expects a file, so give Cited Work Nodes their own menu. Offer Create literature note for unique, ambiguous, and pending keys, with the shared open action resolving or asking the reader to choose. Offer the Zotero and Library View actions for a unique Item, and offer Copy citation key for every node. Read the group from the canonical Indexed Key. Raise the workspace menu event so listeners can add entries. [Click](../../../../packages/citations/src/obsidian/graph-citations/click.ts) · [Context menu](../../../../packages/citations/src/obsidian/graph-citations/right-click.ts)

## Verification required for implementation

Verify independent global and local views, view restoration, and native global graph bookmark restoration into both new and existing global views. Include bookmarks with opposite toggle values, restoration after restart, native hover with popovers off, and group removal followed by shortcut reuse.

In service tests, use the real Note Index and capture its warnings through the logger. Let ordinary tests start from the first answered frame. Test pending lookup and request changes before settling that frame. Model native render as one read of the engine's app followed by a renderer hand-off. Model deferred views with a state-bearing placeholder, and remove a closed leaf from the workspace list before invoking its unload callbacks.

Advance the hover timer in the graph container's window separately from Effect's clock. Simulate native pointer sweep and delayed preview when testing the hold, and close a leaf without sending unhover to exercise disposal. For edge-color tests, give fake sprites a prototype tint setter, allow edges to have no sprite until graphics creation, and paint only when the renderer requests a frame. Read the actual sprite tint after painting. This exercises color changes while both the graph topology and pointer remain still. [Service tests](../../../../packages/citations/src/obsidian/graph-citations/service.test.ts)

## Graph engine and renderer declarations

Treat private Graph members as optional across Obsidian builds. The global
Graph and Local Graph each own an engine and renderer. Rendering reads the
App once, rebuilds the node set, hands it to the renderer for diffing, and
returns the link count. The renderer callbacks are bound on the instance.
Right-click dispatch is optional. The engine owns each node hover's popover.
A renderer unhover can run when the pointer leaves or a frame finds it
outside all nodes. The engine's own pre-hover cleanup can bypass that
renderer callback. Request a frame explicitly if changing only presentation
because diffing unchanged graph data need not wake the renderer.

Filter, Groups, and Display own the registered option keys. Enumerate their
listeners for current values. Applying options reaches row listeners before
rerendering and debouncing persistence. The global graph saves in plugin
data and Local Graph saves per leaf. Restore defaults replays native keys,
so plugin keys need a hook there. Groups clears through its query setter,
which rebuilds the row container including the new-group button. A row
listener serves both read and write across heterogeneous control types.

Node identity is the note path, unresolved linkpath, or tag. The renderer
keeps world coordinates and transforms with
`screen_css = (world * scale + pan) / devicePixelRatio`. Text fade uses a zoom
octave offset. The links array stays stable across data changes. A line sprite
appears once both endpoint graphics are built and may become null when
cleared. The hover or drag node controls edge highlight. Its highlight
colour takes precedence over focused and group colors. A focused node uses
the focus colour when there is one. Group colours include an alpha and
packed RGB. The declarations cover renderer behavior checked in Obsidian
1.13.7 through 1.14.1. [Graph declarations](../../../../packages/obsidian-kit/src/typings/obsidian-ex.d.ts)
