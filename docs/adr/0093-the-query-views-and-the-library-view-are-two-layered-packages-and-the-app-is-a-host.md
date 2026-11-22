---
status: accepted
---

# The Query Views and the Library View are two layered packages, and the app is a host

## Context

The plugin base (ADR 0087), ZoteroReads (ADR 0088), the platform services (ADR 0089), the annotation feature (ADR 0090), the citations (ADR 0091) and the notes with the Template Workbench (ADR 0092) are layered packages. `apps/obsidian` still held the last feature group: the Item Query adapter (`QueryService`, the `zotlit:query` CLI contract, the Item Match filler), the Query View, the sidebar Annotation View, the Annotation Suggester, the PDF view's note button, the Library View, the Welcome View, the Release check, the quick switcher, and the setting tab with the rows of every feature. The largest folder-level value cycle of the app had three units: the settings, the Library View and the Welcome View. A Template Data Explorer stylesheet in `packages/template-workbench` read the app's `zt-main.css` through `@reference`, so a package had a build edge into the app.

The next step adds two more hosts, ZotLit Reader and ZotLit Mobile. What stays in `apps/obsidian` is what each new host must write again.

## Decision

- **Two packages with a one-way edge.**
  - `@zotlit/query-views` holds ZotLit Query in Obsidian and the views that show its results: the Item Query adapter, the Query View, the sidebar Annotation View (a Query View over the annotation cards), the Annotation Suggester and the PDF view's note button. It is the Obsidian host of `@zotlit/item-query`, as `@zotlit/template-workbench` is the host of `@zotlit/workbench`. The adapter cannot live in `@zotlit/item-query`: that package is host-free, and `@zotlit/zotero-reads` imports it, so the adapter's ZoteroReads client would make a package cycle.
  - `@zotlit/library-view` holds the Library View, the Welcome View, the Release check and the quick switcher. It imports the Query Views; nothing imports it.
  - The two are separate because a Reader host shows the Annotation View, which needs the Query View, and has no Library View. The work areas are also disjoint: the Query View's layouts and Query Files against the Library View's tree, Reading Card and onboarding.
- **The Welcome View and the Release check go with the Library View.** The Welcome View is a banner above the Library View, and the Release check shows its notices there ("Releases and onboarding" in the glossary). The Release service and its notices are one unit of ownership. The quick switcher goes with them: its test runs over the Library View's host fixture, and its "Open in Library" action pairs with the library rows.
- **Each package has three layer folders**, as the features before them: `core/` host-free, `obsidian/` mobile-safe, `desktop/` Node and Electron, held by lint. A file sits in the layer of the closure of what it needs.
- **The 3-unit cycle is cut, not followed.**
  - The Welcome View's start-up registration opened the Library View. It is the Library View's registration and moves into the `library/` unit (`desktop/library/welcome-register.ts`).
  - The Welcome View read the host's whole-settings atom. It now reads its own keys through `welcomeSettingsAtom` (`obsidian/welcome/settings-atom.ts`), over `PluginSettings`, with the defaults of the slices that own those keys.
  - The host's settings definition still imports the slices of both views. That edge points from the host down into the package and closes no cycle.
- **Each unit registers itself.** The deleted app typings (`settings.d.ts`, `view-services.d.ts`, `zotero-reads.d.ts`, `zotlit-events.d.ts`) are replaced by declaration merging at each owner: the settings slices in `SettingsRegistry`, `QueryService`, `Release` and `QueryClients` in `ViewServiceRegistry`, the Item Query requests in the ZoteroReads contract (`ItemQueryTypes`), and the `zotlit:item-menu` event in the menu events.
- **Generic code moves down.** The Library View's search text becomes `@zotlit/plugin-services/core/item-lookup/search-text.ts`; the CLI rejection goes to `@zotlit/obsidian-kit`; the Language Pack start goes to `@zotlit/plugin-services/obsidian/language-pack/start.ts`; the Node HTTP client for Zotero goes to `@zotlit/obsidian-desktop`.
- **Ports keep their owners.** `ItemMatchQuery` of `@zotlit/notes` is now filled by `@zotlit/query-views` (`desktop/item-query/item-matches.ts`); the host only composes the layer.
- **Each feature's settings rows live with the feature.** The setting tab's seam to Effect (`effect-tab.ts`, the row context) moves to `@zotlit/plugin-services/obsidian/setting-tab/`. Its service set is open: `SettingTabServiceRegistry` takes the services that each row's file reads by declaration merging, and the host registers the whole context of its tab layer. A page or row with one owner moves beside the owner's settings slice: the platform rows to `@zotlit/plugin-services`, the Pandoc rows to `@zotlit/citations`, the Reader page and the Zotero editing row to `@zotlit/annotations`, the Note import page, the Delete Profile dialog and the default Profile binding controls to `@zotlit/notes`. The host keeps the tab class, the page order, the control store and each page that names several features (Zotero, Citations, Profiles, Templates, Advanced, Resources, Local server).
- **The Tailwind theme has one owner.** `@zotlit/obsidian-kit/theme.css` holds the layer order, the `zt` prefix, the `@theme` tokens, the utilities and the `.zt-root` preflight. A host's stylesheet imports it and lists its `@source` folders; a package stylesheet takes it with `@reference "@zotlit/obsidian-kit/theme.css"`. The lint rule `zotlit-build/no-app-path` fails a package file whose module specifier, or the `@import`/`@reference`/`@source` path of a stylesheet it imports, resolves into `apps/`.
- **Host composition stays in the app**: the plugin entry and lifecycle, the Layer graph, the settings composition and `data.json` migrations, the Worker entries, the `obsidian://` handlers, the setting tab's shell with its multi-feature pages, and the host tests that run several packages over the host's composition.

## Considered options

- **One package for the Query Views and the Library View.** Rejected: a Reader host would take the Library View, the Welcome View and the Release check with the Annotation View.
- **The Item Query adapter in `@zotlit/item-query`.** Rejected: it would make the engine depend on Obsidian and on ZoteroReads, which imports the engine.
- **The `obsidian://` handlers in a package.** Rejected for this step: the action set is the desktop plugin's, and its handlers name the notes, the Template Workbench and the Library View.
- **A closed `SettingTabEnv` in the platform package.** Rejected: it would name every feature's services and make the platform package import the features.

## Consequences

- The app holds 32 non-test files (about 5,800 lines), all host composition. The folder-level value graph of the app and its packages has no cycle.
- A Reader host composes the base, ZoteroReads, the platform services, the annotations, the citations, the notes, the Template Workbench and the Query Views, and leaves out the Library View.
- Most of the Query View and the Library View is in `desktop/`: they import the attachment opens and the Annotations Layout of `@zotlit/annotations/desktop`, and the note creation of `@zotlit/notes/desktop`. A Mobile host needs those to move to `obsidian/` first.

The Library View's Obsidian feature registers the shared settings, the Show in Library and Release actions, and the protocol handler. The desktop feature extends it with the view registrations and fills the Show in Library and Template Migration Prompt ports once the desktop host is ready.

Draw the shared Match editor as a Bases filter menu in Query Views.
Use form backgrounds on conditions, table borders on nested groups,
an unboxed conjunction in the header and bare text actions in the
footer. Keep the property icon and name visible, size short selects
to their text, and let the value wrap onto a new line. Use a divider
before the operator. The Template Workbench supplies its own look.
The view tests check its input to the shared dataset vocabulary.
[Filter menu](../../packages/query-views/src/desktop/query-view/filter-popover.tsx)
