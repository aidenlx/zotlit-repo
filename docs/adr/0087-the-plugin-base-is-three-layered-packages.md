---
status: accepted
---

# The shared base of the Obsidian plugin is three layered packages

## Context

`apps/obsidian` is being divided into packages, so that three plugins (desktop ZotLit, ZotLit Reader, ZotLit Mobile) can be thin hosts over one code base. A package cannot import the app, so the division starts at the bottom: `src/lib` (121 files), `src/components` (16 files) and the generated Message facade, which 385 imports read. 59 of the app's 66 units formed one folder-level dependency cycle, and most of them met in `lib`. Six `lib`/`components` files imported services by value, and eight imported service types. A mobile host has no Node and no Electron.

## Decision

- **Three layers, by what the host provides.** A layer imports only the layers below it.
  - `@zotlit/plugin-kernel`: code that imports no `obsidian`, `electron` or `node:*` (the Effect wrappers and helpers, the log, pure utilities, constants). It also holds the `effectEntry` Vite plugin (`@zotlit/plugin-kernel/vite`), because the wrappers it resolves to live there.
  - `@zotlit/obsidian-kit`: code over the `obsidian` API that loads on Obsidian Mobile (the capability tags, the shared components, view atoms and runners, notices, menus). It also holds the Obsidian test mock, the Vitest setup and a Vitest preset, which every package that tests Obsidian code reads.
  - `@zotlit/obsidian-desktop`: code that needs `node:*` or `electron` and that more than one unit uses. It is a package, not a folder of the app, because the desktop and Reader plugins both need it and a mobile host leaves it out.
- **The Message facade is `@zotlit/plugin-messages`.** Its `generate:language-packs` task writes `generated/` with declared Turbo inputs and outputs. The app's Vite build writes the same folder.
- **A file that one unit uses lives in that unit.** 52 of the 137 files moved into an app unit, not into a package.
- **No upward import.** A file that read a service moved to the unit that owns the concept, or was split so the shared part moved down. `ViewServiceRegistry` is an open interface in the kit; the app adds its services by declaration merging.
- **Lint holds the layers.** The kernel takes the engine boundary rules (`engineBoundaryRules`, `import/no-nodejs-modules`) and refuses the two upper layers. The kit refuses `node:*`, `electron`, `@zotlit/db/client/node` and the desktop layer. The app's custom lint plugins moved to `@zotlit/config`, and one preset (`oxlint-plugin-code.ts`) gives the app and the three packages the same plugin rules. `pnpm review` covers the three package sources, because their code ships in the plugin.
- **Names.** "Kernel" and "kit" name no domain concept, so they do not collide with the Obsidian Plugin glossary. The packages use that glossary's vocabulary and have no glossary of their own.

## Considered options

- **One package for the kernel and the Obsidian layer.** Rejected: a mobile or worker consumer of the host-free code would load the `obsidian` module, and lint could not hold the host-free boundary.
- **The facade inside the kit.** Rejected: the kernel reads messages too, and it sits below the kit.
- **Desktop-only code stays in the app.** Rejected for the shared files: the Reader plugin needs them without the app.

## Consequences

- The folder-level cycle drops from 59 units to 51. `lib` and `components` leave it, and six services that only met it through `lib` leave it too.
- A file whose top level reads an Obsidian global (`activeWindow`, `activeDocument`, `createEl`) belongs in the kit, even when it imports no `obsidian` module.
- Every package that bundles plugin code passes its source folder to `effectEntry` as a scope; code outside the scopes gets the real `effect` package.

## Desktop helper boundaries

- `packages/obsidian-desktop/src/markdown-link.ts` uses a path-only object on the `TFile` prototype to generate Markdown links to attachments before the vault indexes them. The helper fills in the path, name, base name, and extension. The object is only for link generation. An external target instead uses an absolute file URL with optional alias and subpath overrides.
- `reflink.ts` uses the Node exclusive clone flags on Linux and invokes `cp -c -n` on macOS because the Node flags do not provide a dependable clone primitive there. On macOS, an existing regular-file target is left intact. The command has different semantics for directory targets. The process gives the helper an exit code and stderr. The helper recognizes the `clonefile failed` text to allow the caller to choose a fallback. Other errors propagate. [Directory-target follow-up](https://github.com/aidenlx/zotlit-repo/issues/55)
- Each producer owns its rule for identifying residue. `temp-sweep.ts` owns traversal, removal, and logging through Effect's FileSystem, so worker and renderer can use the same sweep. A missing directory is normal before first use. A vanished entry or one without a modification time fails the age check. Read, check, and removal errors produce warnings. An interrupt stops the walk. Import Effect through its package specifier so the worker build can select its logger instead of importing the renderer logger.
- The sweep tests restore permissions before removing their test directory. The failed-removal case requires effective POSIX mode checks and skips Windows and root. The tests sort records by path because the file system supplies traversal order.
- `zotero-http-node.ts` uses a dedicated Node HTTP client for desktop loopback. It sends no browser origin or user agent and does not use proxy environment variables. The test verifies its real wire headers and framing. The client keeps connections alive and destroys a request on interruption. A known byte length avoids chunked framing, which Zotero rejects. Tests close open connections during teardown so listener shutdown can finish.

## Effect entry points and runtime ownership

- Plugin modules import Effect through its public specifiers. The Vite redirect applies to the kernel and the caller's source scopes. The wrapper dependency list and external packages use the upstream modules so resolution does not recurse. The bundle check verifies the expected wrapper in each entry and checks that workers exclude the renderer logger. A bundle can compile with the redirect missing, which makes this wiring check necessary.
- Both entries run on Chromium's task queue. Electron exposes Node's `setImmediate`, which Effect can select and which can starve browser messages and timers during indexing. The renderer adds the plugin logger and disables propagation of trace headers to Zotero and release hosts. The worker leaves level selection to the configured port logger. The wrapper provides the context inside synchronous Effects so a factory for asynchronous work captures the browser scheduler. Caller-provided runtime references take precedence. See [ADR 0050](0050-chunked-work-yields-via-messagechannel.md) for why the task queue uses `MessageChannel`. Node's MessageChannel lets tests use the same yield as the browser.
- `buildRuntime` injects the scheduler and logger as references and registers disposal before lazy acquisition starts. The owner can therefore roll back partial acquisition. Await `runtime.context()` before synchronous reads from any graph that can acquire asynchronously. For external reads with a startup limit, time out the join and let the scoped read continue so its later result can still arrive.
- A bridge captures the built context because ManagedRuntime clears its own context on disposal. Plain code may still read released state through that captured context. The asynchronous runners attach their fibers to the runtime or owning layer scope. On interruption, the Exit runner delivers an interrupt-only Exit, and the Promise runner rejects with `AbortError`. The feature boundary can map that outcome to a released result. For a privately forked fiber, fork inside an uninterruptible mask and restore interrupts for the wait so a cancellation cannot occur between the fork and the start of the wait. The wait interrupts the child and waits for its termination if the owner stops.
- Scoped Stream consumers start immediately so the caller can publish after acquiring them. The plain subscription flushes its dispatcher so upstream fibers started by operators such as `interruptWhen` can attach before that publication. A latest-value stream can otherwise lose intermediate edits. Closed scopes take no subscriptions. Unsubscribing stops delivery immediately, and the runtime's disposal interrupts active subscribers. One failing delivery is logged and later deliveries continue. The tag filter uses one pass so values keep their order across tags.
- Clock adapters read the same Effect Clock in tests and production. Effect DateTime has millisecond precision, so conversion from a Temporal Instant truncates finer precision. The plain code's clock adapter keeps the host clock injectable.

## Worker logging and in-process transport

- An in-process RPC pair uses the same JSON codecs and structured clone boundary as the worker, so a transport defect can reproduce without a worker. The server sees one client and replies to the id the client assigned locally.
- The worker port uses its current log level for each record, so configuration changes take effect without rebuilding the runtime. It checks values with structured clone and falls back to individual members for objects that contain uncloneable values. The logger reports failed posts through the console to avoid recursion. The renderer's DOM callback queues the record. The owning scope closes the port and stops the consumer fiber. The renderer uses the worker's timestamp so queue delay does not alter log chronology.

## Portable utility contracts

- Obsidian vault paths use forward slashes on every platform. `vault-path.ts` transcribes the Node POSIX basename, dirname, and join behavior so mobile code can keep the same paths without a Node import. Compare the port with Node in the kernel's tests. External Obsidian paths carry the `file:` prefix before the absolute path.
- Vault capabilities classify expected conflicts from the vault cache before a host call. A matching path may differ in case. Report an absent adapter read from its `ENOENT`. Preserve the original cause and the host's message on other vault errors so the caller can report or log it. For filesystem operations outside Effect's Node adapter, construct an Effect `PlatformError` with the operation, path, errno reason, and original cause. Checks for an errno without a dedicated reason inspect that cause. [Permission classification follow-up](https://github.com/aidenlx/zotlit-repo/issues/75)
- `clipboard.ts` writes HTML and plain text in one clipboard item. The paste target chooses its supported representation. If rich writing fails, try plain text, report the representation written, and propagate a failed fallback. This gives callers enough information to tell the user whether formatting reached the clipboard.
- `brand.ts` reads the paths of the canonical SVGs and groups them by the source palette so a renderer can apply the theme's two inks. Reject an unknown fill to surface a change in the asset palette. In the wordmark, the first group is the mark. The glyphs in Zot use the ink color and the glyphs in Lit use the accent.
- The plain cancellation boundary preserves the caller's AbortSignal reason when an interrupt-only Exit reaches an aborted signal. Other scope interruptions may map to a released result. Mixed or failed causes propagate. A user who closes a dialog stops the operation with `UserCancelled`; progress notices omit that outcome. Plugin unload interrupts its effects. [Grouped annotation write follow-up](https://github.com/aidenlx/zotlit-repo/issues/76)
- Host Vite configurations define the kernel's build constants. The release process selects Stable Docs or Pre-release Docs for the release line. Local builds default to Stable Docs. The Annotation Suggester and its setting are opt-in at build time through `ANNOTATION_SUGGESTER_ENABLED`. The Resource Release URL uses the publish repository and the plugin version. [ADR 0019](0019-runtime-assets-ship-on-a-parallel-resource-release.md)

## Zotero HTTP boundary

The local Zotero client uses the IPv4 loopback address and remains separate from the remote client. It sends the Zotero-supported integration header. Zotero can close a connection that it identifies as browser traffic, so the desktop client uses Node HTTP without browser headers or environment proxies. Measure request bodies in bytes so Zotero receives a Content-Length instead of chunked framing. Apply caller headers after setting the raw body to preserve Content-Type.

The exchange reads the complete response, including a body returned with an error status. The Promise adapter preserves the former fetch error contract. A cancellation before headers or during the body reports an AbortError. Other transport failures surface as a TypeError with the original transport reason. An aborted request may have reached Zotero, so the caller cannot infer whether it took effect.

The window migration test stand-in restores the element prototype on disposal. It reports moves only for listeners whose element still carries the animation class, matching the Obsidian migration hook.

Expose workspace readiness, events and reads through a capability tag. Keep DOM handlers, component lifetimes and direct leaf edges on the host. An interrupted layout wait leaves the native callback inert because Obsidian supplies no unregister. Keep event order from subscription onward. Find the loaded live text view in any window and skip views whose text has not loaded. Use the private workspace-file reader for restored layout and the active-leaf event runner to flush deferred opens. Reapply registered editor extensions through the editor-options hook.

Run native file and editor menu handlers synchronously in the caller's context because Obsidian consumes the menu when listeners return. Only the chosen entry's action can suspend. Log a failed handler and keep entries already added. Keep production file-menu composition centralized while the workspace capability provides a scoped hook. The workspace mock shares state with direct host callers, can defer file-open events until flushed, and records pane operations without opening real windows.

## Obsidian component and event lifetimes

Capture the caller's Effect context when a Component takes ownership of a
Scope. Close the Scope on unload unless the caller already closed it. Log a
close failure and let the Scope run its other finalizers. Register a
window-local listener on the element's window and move the registration when
the element moves between the main window and a pop-out. [Component Scope](../../packages/obsidian-kit/src/component-scope.ts) · [Migrating listener](../../packages/obsidian-kit/src/disposables.ts)

Subscribe before registering host callbacks because callbacks such as
`onLayoutReady` and `onCleanCache` can fire immediately. Use one ordered intake
per layer. Obsidian's base Events interface erases specific callback argument
types, so adapt them at registration. Run the consumer on the layer Scope,
log handler failures per event, and keep consuming. Scope closure unregisters
listeners and shuts down the intake, so a late one-shot callback is harmless.
The pending count includes all published payloads that have yet to dispatch,
including those the stream already buffered. [Obsidian event intake](../../packages/obsidian-kit/src/effect-obsidian-events.ts)

## Modal answers and settings navigation

Keep modal classes on the Obsidian side. The Effect adapter takes the first
answer and closes the modal on interruption. A confirmation settles to true
on its action and false on dismissal. A choice that closes the modal must
survive the close callback. For SuggestModal, Obsidian closes before it reports
the selection, so the modal guards the dismiss callback when it has a choice
to report. Keep a separate Promise adapter for callers without an Effect
runtime. It opens the modal immediately, rejects if opening throws, and
settles once. Set the active window and document before opening a modal
requested from a pop-out that may lack focus. This opens the modal and its
follow-up dialogs in the originating window. [Effect modal](../../packages/obsidian-kit/src/effect-modal.ts) · [Confirmation](../../packages/obsidian-kit/src/confirm.ts) · [Promise adapter](../../packages/obsidian-kit/src/modal-answer.ts) · [Pop-out policy](../../apps/obsidian/policies/popout-windows.md)

Resolve Settings paths by page IDs, in outermost-first order, so translated or
renamed page titles leave links valid. Groups add no path segment. Resolve the
row from the current tab on each call because Obsidian identifies the row by
its definition object and rendering replaces those objects. Open the page
before scrolling to the row so the target is rendered. The test fixture
transcribes Obsidian's private path resolution. Verify changes to that
behavior in the running app. [Settings navigation](../../packages/obsidian-kit/src/open-settings.ts) · [Settings fixture](../../packages/obsidian-kit/src/open-settings.test.ts)

## Notice lifetime

Use Obsidian's default duration when none is supplied and duration zero for a
notice that stays until hidden. Create a progress notice at its first message
and hide it when its Scope closes. Hold its reporting fiber in the Notifier
layer, so the task can settle while the notice stays visible and unload can
still stop it. The in-memory fixture's tracked notices also need the layer's
Scope. Its signalling layer offers after a notice appears so tests can wait
for delivery. [Notifier](../../packages/obsidian-kit/src/notifier.ts) · [Notifier fixture](../../packages/obsidian-kit/src/__fixtures__/notifier.ts)

Wait 200 ms before showing loading to avoid a flash for fast tasks. Observe
the same task Exit before and after that delay. Use a Deferred or a Fiber
await so the notice cannot start the task twice. Show success for two seconds
by default and errors for four seconds. Omit a failure notice for a direct
abort, user cancellation, or interrupt-only cause. A typed failure that wraps
a transport abort still gets a notice. Log failures eligible for reporting.
Use outcome-only notices for work that can wait on a dialog so loading text
does not show while the user decides. Return the task result to its caller
independently of notification.

The Promise helper also waits before showing loading. It handles early
rejection in the loading race and reports the rejection when it awaits the
original Promise. Its default returns no value and swallows the rejection at
the caller boundary. With `swallowError: false`, it propagates the value or
rejection. Use disposal to clear the lazily created notice. [Promise toast](../../packages/obsidian-kit/src/toast.ts) · [Lazy Notice](../../packages/obsidian-kit/src/notice.ts)

## Environment and device capability

Capture platform flags, version, language and vault identity when the layer
builds. Read core-plugin enablement on demand because it can change during
the session. Obsidian uses its internal app ID for this vault's IndexedDB
names. The currently shipped hosts are desktop-only, and the environment
takes their base path from the filesystem adapter. [Environment](../../packages/obsidian-kit/src/obsidian-env.ts)

Keep device-local storage scoped to the vault on its current device. Preserve
the host's error message and cause. The test source models the host's JSON
round trip, so loading gives a copy. A missing or malformed value loads as
null, and a falsy save removes the key. [Device storage](../../packages/obsidian-kit/src/obsidian-device-storage.ts) · [Storage fixture](../../packages/obsidian-kit/src/__fixtures__/obsidian-device-storage.ts)

## Vault and File Manager capability

Normalize rename targets and use the cached file identity to allow a same-path
or case-only rename. For creation, find an existing file or folder by exact
path first, then look for a case variant among the parent's children. Most
creates miss, so this avoids walking the full vault on a case-insensitive
lookup. Create or rename under the parent's cached spelling because a disk
that folds case can accept another spelling while Obsidian reports a file its
parent does not hold. An adapter rejection after the cache check still
returns `VaultError`. Use the original path to report a rename failure
because Obsidian can change the file object's path. [Vault](../../packages/obsidian-kit/src/obsidian-vault.ts) · [File Manager](../../packages/obsidian-kit/src/obsidian-file-manager.ts)

Read a path through the adapter when the caller needs file contents outside
the cache. Map its `ENOENT` to `FileNotFound`. Use the filesystem adapter to
resolve a full path and to reconcile a file written directly to disk before
the watcher discovers it. Other adapters have no filesystem path to return
and cannot reconcile a disk write. Obsidian's cached read can reuse contents
it already holds. Delegate the system versus vault trash choice to Obsidian.

The File Manager writes Properties from disk, so callers that may find an
open editor use Live Text. Let Obsidian choose the attachment folder and
trash operation from the user's settings. Report an attachment-path lookup
failure on its source path or the root when absent. Resolve a host member only
when a call needs it so a test that uses none can still build the layer.
Capture the synchronous link call at the Template rendering boundary because
rendering produces links inline. Let the in-memory File Manager and Vault
stand in for the same sources plain-code callers use. The File Manager
fixture can reject its next write call, uses a vault-root attachment path,
and uses full-path wikilinks independent of the source note. The Vault fixture
tries an exact path first, supports case variants, and returns `ENOENT` for an
absent adapter path. It can substitute selected reads while retaining its
normal events.

## Metadata readiness and event ordering

Wait for layout-ready before treating a clean metadata cache at startup as
ready. It can report clean before vault indexing starts. Use Obsidian's
`onCleanCache` because it completes immediately when parse and resolution
queues are idle. The public `resolved` event reports a queue drain, which may
never happen in a vault with no indexable files. Expose the host's
`resolvedLinks` object as it updates in place. Leave per-note cache reads,
per-node graph reads, and visible wikilink lookup untraced because they run
inside loops. [Metadata cache](../../packages/obsidian-kit/src/obsidian-metadata-cache.ts)

Deliver Vault and Metadata Cache events in host order from the consumer's
subscription. An idle consumer receives the event before Obsidian runs its
next callback, so an intake that joins multiple sources preserves their
order. The metadata fixture shares state with callers that still read
`app.metadataCache`. It returns null for absent entries and an empty object
for held non-Markdown files. Its link targets come from the test and are
independent of the source note. Delete before announcing deletion while
passing the previous entry. Run queued clean-cache callbacks after the
resolve event, and run a newly registered callback immediately if already
clean. [Metadata fixture](../../packages/obsidian-kit/src/__fixtures__/obsidian-metadata-cache.ts) · [Event policy](../../apps/obsidian/policies/events.md)

## Host registration and fixtures

Tie command registration to the caller's Scope so an interrupted startup
removes commands it already added. Capture the unprefixed ID before
`Plugin.addCommand` changes it in place because removal takes the original ID.
The command fixture uses the same scoped lifetime and rejects access to
members the test did not supply. Hook the native view creator only when the
private registry method exists. Run the callback after creation and before
Obsidian loads the view. Release the hook at Scope close. Remove a settings
tab at Scope close so the native close path can run render cleanup while
its services are available. Close Settings before opening a view from a
settings row. [Plugin host](../../packages/obsidian-kit/src/plugin-host.ts)

Use a Scope to own native event registrations and unregister each on release.
The capability layer publishes tagged events into a shared PubSub during the
native callback, preserving order across event names. There is no replay.
Closing the layer shuts down the PubSub and ends the consumers' Streams.
Use a thin adapter where Obsidian's base Events type erases callback arguments.
[Event source](../../packages/obsidian-kit/src/obsidian-event-source.ts)

Use empty in-memory capability sources for test hosts that omit a capability,
and share the same underlying objects with callers that still receive the
App. The text host starts at layout-ready and uses the default App settings.
Its save fixture models Obsidian's TextFileView. Take a content snapshot when
the save starts, queue a later save, and ignore disk events during a save.
Outside a save, reload a clean editor and preserve unsaved edits. A view can
use CodeMirror-style LF normalization. A test can hold writes before they
reach disk. The gate stops waiting when a write settles and leaves failure
delivery to the save's caller. The fixture's vault rejects a missing adapter
read with `ENOENT` and treats trash as removal.

The text host's metadata follows disk until the fixture holds it. A held
cache returns its last parsed result or null for an unparsed file. Invalid
Properties return an empty entry. The fixture emits only `changed` and resolves
links by exact path with an optional `.md` suffix. Releasing the cache resumes
updates. [Text host fixture](../../packages/obsidian-kit/src/__fixtures__/obsidian-host.ts) · [Capability host fixture](../../packages/obsidian-kit/src/__fixtures__/obsidian-host-app.ts)

## Live Text writes

Use the loaded editor's text when a note is open, including in another window.
A native save can overwrite a disk edit with an earlier snapshot, so replace
text through the view and let it save. A pending native save can queue the new
text and return before the disk write. Skip an unchanged result in the loaded
view. If the view rejects the exact replacement, restore its prior text so
it can still accept disk changes, then run the same synchronous rewrite
through the vault. A rewrite can run twice, so keep external effects out of
it. The Effect boundary uses Workspace and Vault and distinguishes a thrown
rewrite from an I/O failure. [Promise Live Text](../../packages/obsidian-kit/src/live-text.ts) · [Effect Live Text](../../packages/obsidian-kit/src/effect-live-text.ts)

Keep native persistence and undo handling. When Obsidian replaces a single
span across changed lines, map the scroll snapshot over the individual edits
so an unchanged block inside that span stays visible. Use Obsidian's
Properties splice behavior. Preserve existing fence line endings, remove a
block when its Properties become empty, and prepend a block when adding
Properties to a note without one. Let invalid YAML fail the rewrite.

Use the configured attachment folder when supplied. Otherwise derive it
from File Manager's resolved attachment path without writing a file. Represent
the vault root as `/` and join its children without a leading slash. Reuse a
case-variant parent folder and report a blocking file separately. Create the
parent before calling Vault.create, because the latter requires it to exist.
[Attachment folder](../../packages/obsidian-kit/src/attachment-folder.ts) · [Vault folder](../../packages/obsidian-kit/src/vault-folder.ts)

## Remote requests and Promise ports

Use Obsidian's request stack for Effect HTTP calls that need to avoid the
renderer CORS restrictions. Return HTTP error statuses as responses using
`throw: false`. Omit the body for statuses that prohibit one. The adapter
accepts empty, text, and byte requests. Copy byte views to pass only the
intended buffer slice. Obsidian's request method lacks an abort signal, so
interruption ends the wait while the transfer can continue. At an abort-aware
legacy Promise port, map an AbortError back to an Effect interrupt. Wrap other
rejections with the call step and original cause. [HTTP client](../../packages/obsidian-kit/src/http-client.ts) · [Promise port](../../packages/obsidian-kit/src/legacy-port.ts)

## Shared plugin theme

Each host imports the shared theme, lists its own bundled source paths, and
lets package stylesheets reference the `zt:` utilities. The bundler gathers
side-effect CSS imports into the host's stylesheet. Use an explicit layer
order so spacing and border utilities win over the scoped base reset.
Apply Tailwind preflight only under `zt-root`. Obsidian's unlayered controls
keep their native styles. Revert the base layer for native Markdown output
while leaving the surrounding plugin surface and its utilities active.

Clear default color tokens before mapping to Obsidian's palette. Declare
same-name mappings as compile-time references so they do not override the
host's CSS variables. Use a 2 px corner for small marks, where the native
small radius can turn a square swatch into a circle. Map cursor utilities to
the host's Appearance setting. Name the clickable utility separately from
Tailwind's default cursor utility, and keep the same-name link cursor as a
reference. A row revealed by Show in Library fades from the accent tint to
its own background. Reserve scrollbar room with a stable gutter for styled
scrollbars. For a native overlay scrollbar, pad the edge so it cannot cover
content. [Shared theme](../../packages/obsidian-kit/src/theme.css)

## Host declarations for document and metadata access

Use a particular window's detached-element factories to create elements in
that window's document. Obsidian also bundles Turndown as a global. The
editor's clickable tokens are position-resolved, and the Obsidian Editor
exposes its CodeMirror view to commands. A Markdown view in pure reading mode
has no edit sub-view. Let the code-block context replace its own source when
available so Live Preview keeps the widget mounted. A draft can keep a file
view open before its first vault write. The TextFileView dirty marker and
last saved data are the three-way merge boundaries. Reconcile externally
published paths before their links are consumed. Resolve case-variant paths
by exact match first, as native folder creation does. Read
`readableLineLength` through the Vault configuration.

The internal cache of file paths can supply a Graph render but may be absent.
Use the metadata adapters for distinct textual Properties values, including
list entries, and for hashtag counts. The type manager assigns widget IDs by
case-insensitive name and publishes changed names in lowercase. Treat absent
registry members as unavailable. Obsidian's embed registry selects creators by
extension and rejects duplicate registration. A creator can return null for
the native file card. It receives the source note, link subpath, depth and
display mode, uses an empty subpath when absent, and receives `loadFile` after
attachment. Obsidian stops nesting after depth five. The active FileView also
drives native Outline navigation. A saved workspace read is optional and can
return an empty object if unavailable. The private declarations record these
interfaces from Obsidian 1.13.7 through 1.14.4. [Host declarations](../../packages/obsidian-kit/src/typings/obsidian-ex.d.ts) · [Query View block write](../../packages/query-views/src/obsidian/query-view/block-write.ts)

Provide the native icon button classes separately so controls can keep
their own element, label and content. Construct plugin-page links
through the Obsidian community browser URI helper.

Expose a Fiber exit as a value to plain callers. For an Effect caller,
joining propagates interruption, including the case where the child
interrupts its caller before the join starts. Keep the exported theme
CSS hooks stable. Filter Expression signature hints mark the active
parameter, and the Annotation SVG hook identifies each rendered
page's overlay.

The desktop Zotero HTTP client uses Node's transport. The Local API
uses HTTP, so load the HTTPS agent on its first request. Supply no
automatic Chromium Origin or user-agent headers, CORS checks, or
environment proxy. Interrupting a request destroys it. Keep connections
alive to preserve the previous transport's Connection behavior.
[Zotero HTTP](../../packages/obsidian-desktop/src/zotero-http-node.ts)
