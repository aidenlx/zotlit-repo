---
status: accepted
---

# A host composes features on the plugin shell

## Context

After ADR 0093 every feature lives in a package, but `apps/obsidian` still wrote the composition by hand: the Layer graph and its build strata (`services/plugin-layer.ts`), the handles (`services/plugin-runtime.ts`), the plugin class with every view, menu, suggest and ribbon registration (`zt-main.ts`), and the tab shell with its page order (`setting-tab/index.ts`). A feature that added a service changed three or four host files. ZotLit Reader and ZotLit Mobile would each copy all of it.

## Decision

- **A shell package.** `@zotlit/plugin-shell` owns the plugin class (`shellPlugin(host)`), the lifecycle and the interrupted start-up release, the runtime, start-up failure handling, the setting tab shell, and the platform services as two features (`platform`, `desktopPlatform`). Its `core/` and `obsidian/` layers read no Node.
- **One value per feature.** Each feature package exports one `defineFeature` value: service groups (the tags each layer fills and reads), registrations, settings slices, setting tab entries and slots, rebuild streams, control codecs, protocol handlers, handles, and a start-up hook that answers its menu segments.
- **The shell derives the rest.** The build order comes from the tags (a stable topological sort). The settings definition comes from the slices. The tab places entries by the host's page order. A page that shows rows of several features holds a slot that those features fill.
- **Open ports fail the build.** A group that reads a tag it does not list fails to type-check. A host whose features read a tag that none of them fills fails to type-check, and the error names each tag. A cross-feature function becomes a tag that the reading package owns.
- **The host declares what differs.** The app keeps the feature list, the tab and menu orders, the settings history (`data.json` migrations), the Worker-backed capabilities, the plugin class's preflight, the build config and the host tests.
- **One list of plugin packages.** Vite, Vitest and ESLint read the list from `@zotlit/scripts/plugin-packages`, which follows the host's dependencies. `lint:plugin-packages` checks the two static copies (Tailwind `@source`, the turbo review inputs).

## Consequences

- A new service is one `serviceGroup` in its owner's feature. A new feature is one entry in `features.ts` plus its tab and menu ids in `host.ts`.
- The service start order is now derived from the tags, not the hand-written strata. Registration layers acquire concurrently after the service groups. Menu rows, tab pages and editor-suggest order stay as the host declares them.
- A second host composes the platform and the features it needs, and supplies the ports they leave open. The annotations test fixture `reader-host.ts` is that composition for a reader, with stubs: ZoteroReads, FileSystem, ZoteroPref, ZoteroHttp, LocalServer, AnnotationNoteActions, AnnotationViewReveal, PdfTargetReader and ShowInLibrary.

## Update: pages, handlers and Node-free values (2026-11-19)

The first version of this decision left the setting pages that name several features and the `obsidian://` handlers in the app, as one host feature. They now have owners, and each feature has a value for a host without Node.

- **Two values per feature.** A feature package exports a Node-free value (`src/obsidian/feature.ts`, `defineFeature`) and a desktop value (`src/desktop/feature.ts`, `extendFeature(base, parts)`). A host lists one of them. `extendFeature` keeps the base's parts first, concatenates a slot both fill, merges handles and menus; `handlesOf(base)` reads the extended feature's handles. Chosen over listing two values side by side: the host keeps one entry per feature, so `defineHost`'s missing-port check, registration order and handle lookup see one feature, and a host cannot list the desktop half without its base.
- **Every page has an owner.** A page that shows rows of several features belongs to one of them and holds slots; the owner exports the slot ids as a constant so a filler's program reads their declaration. The Zotero and Advanced pages belong to the platform (`plugin-shell/src/obsidian/setting-pages/`).
- **Every `obsidian://` action has an owner.** Each is a `protocolHandler` of the feature it acts on; the shared checks, outcomes and notices live in `@zotlit/plugin-services/obsidian/protocol/`. A handler may read the registration's Scope.

Consequences:

- The app holds no page and no handler. A Node-free host (`apps/obsidian/src/__fixtures__/mobile-host/`) composes the platform and every Obsidian value over 18 stub ports; `tsconfig.mobile.json` and `scripts/check-mobile-host.ts` check it in `typecheck`. The check proves the composition's ports and that its program reads no desktop file; it does not prove the absence of Node globals, because liquidjs's and undici's typings load `@types/node` into every program.
- Service ties now break base-first inside a feature: AnnotationRepository builds before ExcerptPreparation/ExcerptDisplays, GraphCitations before AnnotationPopover (independent groups).

## Update: ZotLit Reader is the second host (2026-11-20)

The second host is ZotLit Reader (`apps/reader`). It composes the platform base and its own reader feature, and the annotations stay in ZotLit.

- **Its features.** `apps/reader/src/features.ts` lists `platformBase`, a `FileSystem` group over the vault adapter, and `reader` (`@zotlit/reader-feature`): ZotLit Reader works with no ZotLit and no Zotero, and the annotation tools stay in ZotLit.
- **A Zotero-free platform part.** `platformBase` (`plugin-shell/src/obsidian/platform-base.ts`) holds what every host has: the log level setting, the Language Pack notices and the Advanced page. `platform` extends it with the Zotero preferences, the connections and the other Zotero services. The Reader's lint keeps its imports to `platformBase` and Zotero-free packages.
- **The host gives its identity as values.** `defineHost` takes the Language Pack catalog, runtime, namespace and repository, so each host loads its own Messages from its own Resource Release. The build gives the plugin id (`__PLUGIN_ID__`), which names the host's log category.
- **Two plugins, one contract.** Each host runs its own runtime. ZotLit reaches the Reader through the workspace handshake of `@zotlit/reader-api`, and each host lists only its own features.

Consequences:

- `annotations/src/desktop/__fixtures__/reader-host.ts` stays a test of the annotations' ports over the full `platform`; ZotLit Reader's composition is `apps/reader/src/features.ts`.
- A feature that both plugins need goes into a shared package and into each host's feature list; a feature of one plugin reaches the other only through the Reader API.

## Acquisition and release contracts

- In `core/graph.ts`, the earliest declared group whose dependencies are ready builds next. The shell base supplies ambient tags to every group. Reject a missing provider, two providers for one tag, or a cycle at composition time. Stack the groups so that each group releases before the services it uses. In `feature.ts`, group types reject unlisted reads under `~unlisted`, and `defineHost` reports unsatisfied feature, view, and tab ports under `missingServices`. The diagnostic types put each missing service in a tuple so TypeScript displays it separately. Hosts check the intersection of their slices against their settings registry. Composition rejects duplicate settings keys and duplicate page entries within a feature and its extension.
- In `compose.ts`, registration layers acquire concurrently after the service groups. Feature order determines the input list for that merge. The shell reads all handles after the runtime acquires, then runs the feature hooks in host order. A hook can use the merged handles of another composed feature through its base value. Host menu order applies to rows within each section. Segments omitted from that order follow in feature order.
- In `base.ts`, settings acquire before logging so logging starts at the stored level. Logging acquires before the rest of the graph so service startup is recorded. The file manager depends on the vault's cache. Start the Language Pack before preflight so notices outside the graph use the active language. The graph's Language Pack continues from that state and owns subsequent notices. `GraphBuilt` settles after graph acquisition so ports that open UI can wait for the graph to be ready. Start a CLI handler through the command runner and let its decoder report missing flags. Convert handler rejections to text because Obsidian prints an object rejection as `[object Object]`.
- The plugin owns the startup stack. It transfers the stack to the instance after all wiring succeeds. An error or an unload during startup lets the local stack roll back acquired resources. Tag a startup defect with the innermost failing layer and pass interruptions through. The startup notice names that layer and the original error aborts startup. On unload, dispose feature hooks first, interrupt CLI handlers next, and close the graph last. Keep the service bag available through the public debug property only after startup commits. External scripts and End-to-end Run cases read it by name through Obsidian eval. In-bundle callers take explicit dependencies. Clear the property before asynchronous disposal.
- Obsidian can create a new instance while the previous instance still acquires or closes resources. It evaluates the bundle again on each load, so `lifecycle.ts` stores the previous instance's release promise on the longer-lived App, under a per-plugin `Symbol.for` key. The End-to-end Run uses the same key from `core/release-key.ts`. Register the release resolver first on the stack so it runs last. This keeps the preceding instance's command cleanup, CLI names, and listener separate from the next instance's startup. Allow startup after ten seconds to recover from stalled disposal, and log that event once the production logger has sinks. Use the main window's timer for this plugin-wide wait.
- Mark an instance unloaded before invoking Obsidian's cleanup because that cleanup can throw. Obsidian drains the registered callbacks once. A later registration runs its cleanup immediately, and an interrupted startup exits at its next unload check. An instance that unloads before it starts waiting leaves the preceding release in place. Start the last settings write during unload so rapid re-enable reads it. Writes made by views during later cleanup use the same handoff.
- The protocol registration runs each handler in its layer's Scope so unload interrupts work still running. A handler can use the scope for work that outlives its own invocation, such as modal callbacks. Obsidian removes the registered URL handlers at unload. The callback returns the fiber so the protocol tests can join it and inspect its outcome.

## Setting tab contracts

The declarative tab reads settings through the first codec that claims a key. Keys without a codec go through the settings store directly. A codec can adapt a persisted value to a dropdown or give a feature control over its own storage. Obsidian awaits the write before refreshing visibility and enabled state. Its callback supplies no error notice, so the tab adapter reports write failures. The setting tab layer owns the subscriptions. Each feature drops any initial replay from a rebuild stream. The layer coalesces subsequent changes because a rebuild rerenders every render row. Rebuild for changes to row membership, such as a new effective listener port, approved folder, or library scope. Let normal scalar edits follow Obsidian's render cycle so inputs keep focus.

Group the navigable pages below the top-level rows. The Zotero page follows the order a researcher encounters the choices. Put device-specific location details one page deeper. Desktop supplies database and sync rows because they need the Zotero data folder. The annotations feature supplies the editing row. Keep the selected Libraries in a separate list because Obsidian groups cannot contain lists. The Advanced page owns logging and the Language Pack reset and lets contributing features supply their own rows through slots.

Use Obsidian's SecretStorage for remembered write authorization so the user can inspect or delete it in Keychain. See [the authorization decision](../../apps/obsidian/docs/adr/0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md). The desktop platform sends the Companion's post-checkpoint Freshness Signal through the same coalesced refresh path as filesystem events. See [the Freshness Signal decision](0024-freshness-signal-follows-the-checkpoint.md).

## Desktop host seams

The desktop host supplies the embedded ZoteroReads and citation parsing worker bundles. Its Electron preflight checks the build-time minimum from package metadata before acquiring plugin resources and points users of older installers to the update notice. The End-to-end Run sees the composed service handle through a type-only entry. Tailwind scans the bundled packages through explicit sources. The repository lint checks that list against the plugin package manifest.

Bundle-time declarations describe the worker source strings, the two Pandoc Lua variants, and the pinned Chinese Segmenter artifact. A host test can use a stub graph while checking composition.

The mobile fixture lists each Obsidian feature value and replaces the Node-only ports with stubs. Its type program excludes desktop registrations so those open registry entries cannot require desktop-only services. The runtime proof supplies memory-backed Obsidian sources, an empty settings store, and no graph view. Keep the stub Profile registry unloaded to avoid reading documents. The feature and port checks show that the graph can compose with supplied host capabilities.

Profiles leads the settings pages because it extends the default Profile controls on the top page. Tests exercise the composed definition tree, including sibling ids and row order across feature slots. A snapshot of the real tree catches an accidental slot reorder. A lower bound on visited ids guards against testing an empty tree. The deep-link cases use ids from that same tree because links can fail silently when a definition is renamed. When tests need only a subset of services, install stubs for the other ports that fail if they are read. A tab rebuild test changes the Workbench Connection, the Language Pack, and settings through the subscriptions and verifies which changes affect definitions.

## Protocol integration tests

Tests register protocol handlers and Local Server request subscriptions against the same per-case service context, with the test Scope owning both lifetimes. A dispatch joins the registered handler's fiber before asserting on its effects. Modal fixtures permit a test to hold the dialog open until scope closure, or to run its callback within the test layer. Cases that only check the modal opening can leave that bridge stubbed. The app stub supplies an undefined React marker so Vitest can print an unexpected value without triggering the stub's missing-member error.

The desktop annotations composition extends the Obsidian feature with filesystem-backed Excerpt Images and recovery, the Target Opener and attachment commands, and the `open-attachment` protocol. Its test host supplies the platform and stub ports so adding a port to annotations requires a corresponding provider in the fixture. The runtime test builds the graph over in-memory Obsidian storage. The fixture models a closed Local Server without Zotero pushes and an absent Annotation View. [Feature](../../packages/annotations/src/desktop/feature.ts) · [Host fixture](../../packages/annotations/src/desktop/__fixtures__/reader-host.ts)

## Native leaf and window state

Keep Obsidian's serialized leaf ID, group, and pin state when handing off a
view. Use the descriptor and ephemeral history together. Run the view state
completion callback after native group assignment and ephemeral handoff, then
refresh the tab title and tooltip separately from the content header.
Obsidian can flush its deferred file-open and active-leaf events on request.
Focus the desktop window directly when detached Settings owns focus. A New
Tab uses the leaf's own empty view, which rebuilds its pill actions on open.
Probe that view structurally. The native actions depend on enabled core
plugins and whether the vault is empty. [Host declarations](../../packages/obsidian-kit/src/typings/obsidian-ex.d.ts) · [Empty-view adapter](../../packages/query-views/src/obsidian/query-view/empty-view-action.ts)

Derive a host's Plugin Packages by following its workspace runtime
dependencies and selecting the kernel and its consumers. Build, test,
and review use that list. Review also includes the separately named
`pluginSources` dependencies that do not build on the kernel. Check the
static lists in Tailwind sources, Turbo review inputs, and the review
TypeScript program against the derived list. The Resource Pack bundles
no Plugin Packages.

The reload regression cases observe unterminated workers, listeners and
Live Updates servers by port. Cancel a startup while it still waits for
its services. For the overlapping-start case, hold the old instance's
settings read while creating the new instance, then check the App's
release handoff. Read current services from the instance now running.
The timing bound covers the internal waits and window restarts.
[Reload cases](../../packages/e2e/src/window-reload.e2e.ts)

### Host entry and body

Keep Effect and Feature evaluation out of the small entry. On a cold
Obsidian start, a layout-ready host loads its body with a dynamic import
after layout. An enable after layout starts in onload. The entry
registers incoming link actions before the body starts and queues
early links in order. After startup commits, dispatch through the
body's handlers. Register additional actions through the host API.
Feature link handlers can use the plugin Scope for callbacks that
outlive one handler. Verify the entry's action list and Feature
actions at typecheck, with missing and unregistered action names in
the type error. Check the composed settings slices against Settings
at the same boundary.

A layout-deferred startup failure has no awaiting onload, so the entry
prints the failure and shows an English notice before it has a
Language Pack. Apply the current Language Pack before preflight and
graph acquisition so their notices can be localized. Desktop preflight
checks the bundled Electron against the build-time minimum and links
to the installer update before acquiring any resources.

Every host composes the Zotero-free base. For Zotero integrations the
host supplies preferences, Local Server, Zotero HTTP, and ZoteroReads
ports. Use one installed Resource Pack watch across Managed Binaries.
Refresh Library Scope when the database updates or a Library changes.
Each Feature file-menu entry supplies a section and the host orders
entries inside the section. Settings tests keep unrelated subscriptions
quiet while exercising Language Pack and settings updates.
[Entry](../../packages/plugin-shell/src/obsidian/entry.ts) ·
[Desktop body](../../apps/obsidian/src/zt-body.ts)

Host bundler definitions supply the Plugin Kernel build environment
constants.
