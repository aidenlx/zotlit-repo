# The Companion hand-injects chrome only where Zotero offers no registry

> **Status: accepted.**

Every Companion UI surface until now went through a Zotero plugin registry —
`MenuManager`, `ItemTreeManager`, `Reader.registerEventListener`,
`PreferencePanes` — and `main.ts` recorded that no subsystem needed
window-scoped teardown. The Database Status control breaks that: Zotero
exposes no registry for a standalone item-pane sidenav button, so the
Companion builds a `toolbarbutton` with `document.createXULElement` and
appends it into `#zotero-view-item-sidenav` itself. The rule this sets is
narrow — use a registry wherever one exists, hand-inject only where none
does, and own the node's removal on disposal.

## Considered Options

- **`Zotero.ItemPaneManager.registerSection`**, the only sanctioned route to a
  sidenav button. It forces a real item-pane section body with per-item render
  hooks, and places the button inside the sidenav's `_buttonContainer`, where
  pin, drag, reorder and order-persistence all act on it. Database freshness
  is a window-level fact with no item to render, so the section would have
  existed solely to earn its button.
- **A `toolbarbutton` in `#zotero-tabs-toolbar`**, beside the sync button.
  Also hand-injected, so it concedes the same rule while giving up adjacency
  to Locate — the control this one is modelled on.
- **No control at all**, leaving the checkpoint invisible and the stale-data
  how-to reachable only from the docs site.

## Consequences

- The node is appended as a `.pin-wrapper` sibling **outside**
  `_buttonContainer`, mirroring where Zotero puts its own Locate button. Every
  pin, drag, reorder and persist loop is scoped to `_buttonContainer`, so none
  of them enumerate it. Injecting inside that container would silently occupy
  a slot in the reorder index.
- `onMainWindowUnload` stops being a no-op, and `main.ts` now models
  per-window state. Disposal removes the node from every still-open window and
  looks up rather than touches closed ones, the rule `active-reader.ts` and
  `application-blur.ts` already follow.
- The button styles itself with `class="btn"`, `custom="true"` and two inline
  CSS custom properties, so the Companion still ships no stylesheet. This
  depends on core SCSS that is not plugin API; a Zotero redesign of the
  sidenav would break the look before it breaks the function.
- `itemPaneSidenav.js` is identical in Zotero 9.0.3 and 10.0, so this needs no
  version branch today. That is a fact about two releases, not a guarantee.
- Injection is verified live over RDP rather than in Vitest. A fake faithful
  enough to prove placement would have to reproduce `connectedCallback`,
  `.pin-wrapper` layout and `render()`'s selector passes, and would then be
  testing the fake.

## Bootstrap and per-window localization

Zotero passes lifecycle data and a numeric reason to the bootstrap hooks. The window hooks also receive the affected window. The reason table mirrors Zotero's loader, including the uninstall-cancel path that reuses the install reason. Both upgrade and downgrade pass their reason through teardown of the old version and startup of the new version. Zotero 9.0.3 calls the window-unload hook with the window-load reason. The Companion dispatches by hook name and window instead of inspecting that reason. [Zotero plugin loader](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/plugins.js)

Load the main IIFE into a dedicated scope. Its footer exposes the constructor through a top-level variable. An explicit scope keeps the IIFE's other globals out of the bootstrap sandbox and avoids depending on a bundler's treatment of top-level `this`. Bundle and Fluent filenames live in a dependency-free module so Node builds and the Zotero runtime use the same names. The development runner's startup marker means Companion startup has finished.

Register subsystems on one LIFO disposable stack. Database Status has one control per main window. The global Fluent registration does not attach translation resources to a window's `document.l10n`. Link the plugin's Fluent resource once per window. Process existing windows at startup because install and enable can happen with a main window already open. The window-load hook covers windows that open later. Required messages fail when their resource is missing, and menu arguments are serialized because Zotero assigns them to a dataset field.

The bootstrap error path and the main logger share the browser-console adapter. It uses Gecko's script-error service to preserve severity and source label while supported Zotero builds still need the compatibility path. [Upstream fix](https://github.com/zotero/zotero/pull/5920) · [Adapter removal](https://github.com/aidenlx/zotlit-repo/issues/93)

## Companion menu and preference boundaries

Collection actions accept one Library or Collection row. The Zotero 10 context carries selected rows in `collectionTreeRows` and its old singular getter throws. Check for the plural shape before reading a row. The singular path supports Zotero 9. The tests supply a throwing getter so an accidental read fails. Multi-row selections and virtual rows have no batch scope. My Library uses group id zero and bypasses the group-id lookup, which accepts only a group Library. [Zotero 9 menu context](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/zoteroPane.js#L3713) · [Zotero 10 menu context](https://github.com/zotero/zotero/blob/10.0.0/chrome/content/zotero/zoteroPane.js#L4113)

Keep PDF eligibility synchronous so the item menu can display immediately. It accepts a PDF attachment or one selected Item with a PDF child. Obsidian checks the file itself. A reader command that targets a Literature Note uses the attachment's top-level Item. A reader command that opens a PDF uses the Attachment itself. The general submenu stays disabled for an attachment-only selection because its entries use regular Items or notes. The menu test verifies its state against the visible entries. Multi-item updates use one batch, and the update label uses the selection count for Fluent pluralization.

Menu registration returns per-surface teardown for development reloads. Format labels for UI registries that use Zotero's synchronous core-only Fluent lookup. The test must install its Localization stand-in before importing menu modules. Preference keys use ZotLit’s complete branch, so the wrapper passes Zotero's global flag to prevent Zotero from adding its own extension prefix.

## Literature Note column

The item list holds an in-memory set of Indexed Keys. On successful status fetch, replace the set and repaint the registered column. A focus-triggered fetch has a five-second minimum interval and avoids overlapping background fetches. A manual refresh bypasses the throttle and reports its outcome in a progress window. A late earlier response can currently overwrite a newer manual result. [Note status response order](https://github.com/aidenlx/zotlit-repo/issues/94)

The header uses the Obsidian logo and the column picker uses the formatted label. The row indicator uses the Obsidian purple for the window's color scheme. Resolve the scheme during render so repaint can reflect a theme change. [Obsidian brand colors](https://obsidian.md/brand)

## Database Status repaint

Visibility follows the Checkpoint independently of Live Updates. Hide the control for an expected no-WAL result. Keep it visible after a probe failure so the tooltip can report the failure. Checkpoint settlement and the automatic-write preference both trigger a repaint. Derive the icon and menu from the same state precedence. The icon path skips timestamp formatting since it runs for every repaint. Zotero's accent tokens follow its color scheme. The neutral icon inherits the default stroke, and the tooltip also describes the state. The guide links to the Chinese page for a Simplified Chinese locale and the English page otherwise.

## Sandbox types

The runtime and its type package expose different surfaces. Local declarations cover the sandbox's profile directory, script loader, focus and window mediator, and per-window Fluent attachment. A null mediator type means any window. The collection context uses an optional plural field so both Zotero versions type-check. The dynamic menu method takes serialized strings because it writes directly to `dataset.l10nArgs`, whereas the static field can take structured arguments. The reader type also exposes the internal selection reducer used by ADR 0106. [Zotero menu manager](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/pluginAPI/menuManager.js) · [Window mediator interface](https://searchfox.org/mozilla-esr140/source/xpcom/ds/nsIWindowMediator.idl)
