---
status: accepted
---

# The platform services are one layered package, and settings are slices

## Context

The shared base of the Obsidian plugin is three layered packages (ADR 0087), and ZoteroReads is its own package (ADR 0088). The services that every feature stands on still lived in `apps/obsidian`: settings, logging, the Language Pack, the Zotero preferences, the Local Server and Zotero Local API, the database actions, the Held Read client, Library Scope, the item search, the Note Index, the Use Ledger, the Managed Binaries, the Chinese Segmenter, the attachment resolver and Attachment Import. A package cannot import the app. The settings schema named the keys of every feature, so the settings service could not move without its features.

## Decision

- **One package, `@zotlit/plugin-services`, with three layer folders.** `core/` is host-free, `obsidian/` loads on Obsidian Mobile, `desktop/` reads Node and Electron. A layer imports only the layers below it. Lint (`no-restricted-imports`) holds each boundary.
- **A unit moves only when everything it imports is in a package.** A service that reads a feature stays in the app until that feature has its package (Item Query, the Local Bridge, attachment-open, the batch helpers).
- **Split a service whose tag and Node implementation share a file.** The tag goes to `core/`, the layer to `desktop/` (ZoteroPref, LocalServer).
- **Settings are slices.** Each owner keeps its keys, schemas and defaults beside its code (`settingsSlice`). `SettingsRegistry` types every key: the package registers its slices, and a host registers its feature slices by declaration merging. `PluginSettings` takes the composed `SettingsDefinition` and the migration hooks from the host. The host keeps the composition and the `data.json` migrations.
- **A helper that names feature keys is a function of that feature.** `updateDefaultLiteratureNoteProfileBindings` is a function of the Profile slice over `update`.
- **Each service registers itself in `ViewServiceRegistry`** in its own tag or atoms file.

## Considered options

- **One package per service.** Rejected: many small packages with the same boundaries; layer folders give the same lint with less configuration.
- **The full settings schema in the package.** Rejected: the package would name every feature key, and a feature could not own its settings.
- **A compatibility re-export in the app.** Rejected: two import paths for one module, and the app keeps its old shape.

## Consequences

- The largest folder-level value cycle drops from 46 units to 35. Eleven units leave it.
- A new feature key goes in the feature's slice and in the host's composition, not in the package.
- Every consumer that bundles plugin code passes the package source to `effectEntry` and to Tailwind `@source`.

## Native Settings identity and navigation

Use a stable ID from the row's label message key and keep it unique among
siblings. Require IDs in the declarations so omissions fail type checking.
Obsidian 1.14 uses IDs before derived control, group, and page keys for
reconciliation and search navigation. Older hosts use those derived keys,
which still need to distinguish siblings. A plugin's manifest supplies its
tab ID and label. Duplicate sibling page IDs log an error.

Open the Settings modal separately from looking up a built-in or plugin tab.
Rendering a new tab closes its open sub-pages. The native search index
flattens registered definition trees and matches names, descriptions, and
aliases. Group hits by tab and page path and order them by score. A synthetic
navigation result can descend the page path without an actual search. The
path uses outermost-first IDs, with name fallback for native definitions
without IDs. Scroll a definition only once its relevant page is rendered.
Removing a tab closes it when active so render cleanup runs before hiding it
and removing it from the search index. [Settings declarations](../../packages/obsidian-kit/src/typings/obsidian-ex.d.ts)

## Declarative Settings tab boundary

Build a flat settings definition from the host's selected slices. Each slice
provides defaults for all of its keys, and owners extend the type registry
by declaration merging. The JSON value constraint permits readonly
collections so structured settings can keep their schema's readonly types
and still persist to plugin data.

Page owners declare named extension slots. Collect their rows in the host's
feature order. Include the manifest in the definition context because its
version and path are available during registration, before the plugin's
debug services getter is ready. Read service data lazily through callback
Effects. Definition builders can run for registration and each update.

Row owners merge the services they read into the Settings Tab environment.
Use synchronous Effects for values the host needs immediately, including
reads and predicates. Run writes and actions in a fiber in the tab layer's
Scope. The returned Promise settles after the action, so Obsidian can await
control writes before refreshing. Log action failures and show the labelled
failure when a label is supplied. An action that owns its notice omits the
label. Interruption is silent. Mount live row Effects in a row Scope and
return their interrupt as render cleanup. Late-bind tab rebuilds because the
service exists before the tab. Request a rebuild when definition structure
changes, outside the row's render, since a rebuild rerenders every render row.

Each test program supplies its services over fail-fast stubs. A missing
Effect member fails as a defect. An unused plain member throws on access.
Run test fibers in the current Scope and Clock. Plain tests close their own
Scope on finish. Record exits and labels separately from actual failure
notice behavior. A test can observe rebuild requests and the Settings close
callback. A test that supplies a view service merges it after the empty
registry stand-ins. [Settings Tab runner](../../packages/plugin-services/src/obsidian/setting-tab/effect-tab.ts) · [Tab definition context](../../packages/plugin-services/src/obsidian/setting-tab/context.ts) · [Harness](../../packages/plugin-services/src/__fixtures__/setting-tab-harness.ts)

## Logging lifecycle and file actions

Use a console sink at startup so services that start before log settings
apply can report their first records. Apply changes one at a time and keep
only the latest waiting change. Retry a failed configuration on the next
settings change, and report configuration failures through the error logger.
A null level disables ZotLit output and skips opening the file. Close the
old file Scope before opening a replacement because both use the same
truncate-on-open path. On unload, finish the current apply before draining
the file and removing the sinks. [Logging layer](../../packages/plugin-services/src/obsidian/log/service.ts)

Put desktop file actions under the logging toggle through the Settings
Tab slot. Resolve the log's filesystem path through Vault for the desktop
open action. Map an operating-system refusal to a typed port failure.
Export reads the vault log and packages it in a downloadable ZIP. Report
failures through the settings notices. [Desktop open](../../packages/plugin-services/src/desktop/log/open-file.ts) · [Export row](../../packages/plugin-services/src/obsidian/log/settings-rows.ts)

## Library Scope resolution and repair

Persist stable selectors in canonical order. Reject empty, duplicate, or
misordered Selected Libraries values. Keep the invalid flag in the replayed
state even when the database is unreadable. Retain the library rows
separately from their selected resolution so consumers can also list all
available libraries. Ignore a queued Held Read settlement when it no longer
matches the current entry, because a source degradation might already have
removed it. Keep Zotero group ID ordering distinct from local database ID
ordering in tests.

Use the effective scope in Settings, including the My Library fallback for a
broken saved value. A valid edit replaces that value and clears the inline
warning and one-off notice. The notice re-arms after a repair and closes with
its Scope. Disable editing while the database is unreadable. A readable
database with no available libraries still permits edits. Keep unavailable
selectors selected and label them by selector because no display name is
persisted. Mark a specific library unavailable only when a database
resolution exists. Under Selected Libraries, place the list beside the
mode row's group because the group cannot contain a list. Suppress delete
for the final entry. A new selection starts at My Library, and switching to
All Libraries drops the previous selection.
[Library Scope](../../packages/plugin-services/src/obsidian/library-scope/service.ts) · [Library Scope Settings](../../packages/plugin-services/src/obsidian/library-scope/settings-rows.ts) · [Notice](../../packages/plugin-services/src/obsidian/library-scope/notices.ts)

## Item Lookup lifecycle

Keep the Item Index in the ZoteroReads worker. Resolve the renderer's current
Library Scope to ordered local IDs, or use the Libraries supplied by the
caller. Attach live names from the Library snapshot for multi-library
searches, so a name change needs no index rebuild. Empty queries can rank
cited and recently used Items. Preserve the historical citation-prefixed
setting key for citation-key display because saved plugin data uses it.

Prewarm a nonempty Library Scope at startup and after a scope change. If its
stable selectors and local IDs change, interrupt pending searches before
their results can reach a picker. A rename alone leaves pending searches
valid. Compare both identities because another database can reuse a local
ID. Start the prewarm without waiting for search cleanup. An unresolved
request or unavailable database answers empty. Log other search failures
and return no rows.

One-shot searches run independently. A session uses one FiberHandle, so each
new search interrupts its predecessor. Defer the start until the set or
handle owns the fiber, and transfer interrupt ownership between startup
and waiting without a gap. When a new search supersedes an old one, make
the replaced waiter follow the newest answer so its renderer cannot show
an outdated list. Unload and session closure interrupt work and answer
empty at the Promise edge. [Item Lookup](../../packages/plugin-services/src/obsidian/item-lookup/service.ts) · [Promise edge](../../packages/plugin-services/src/obsidian/item-lookup/handle.ts)

## Note Index startup and invalidation

Combine the Vault, Metadata Cache, and layout-ready sources in one ordered
intake. Delivery in the host callback lets a change and a rename in the same
tick land in their original order. After layout-ready, wait for the clean
cache callback before the Full Scan. The empty cache can look clean before
Obsidian loads the vault. If both signals are ready at runtime enablement,
start consumption immediately so the scan completes during acquisition.
Publish one indexed event for that Full Scan. Use the scan barrier before
create-versus-existing decisions to avoid duplicate notes. A scan error
settles the barrier and the intake continues with later updates.

A rename announces moved keys before reading the cache in a microtask.
Obsidian can move the same file's cache entry in a later Vault listener,
depending on startup registration order. If the cache has no entry yet,
retain the previous contributions until a metadata change or deletion
settles them. For a consumer waiting on renames, cross the intake barrier
before taking the pending rename set. Settle rename completions even on
failure. Finalization settles waiting barriers and rejects late host
callbacks because the native one-shot registrations have no unsubscribe.
The startup stack keeps the index available until dependent edges finish
their teardown.

Keep Item and imported-note key maps separately. Compare serialized
frontmatter to distinguish Properties edits from body edits. Publish a
key change before a frontmatter change, and treat deletion as removal
without a frontmatter edit. For synchronous consumers, expose snapshot
facts and order an Item's notes by descending mtime with a path tie-break.
Resolve Profile membership by ID and treat the stamp's label as a hint.
Sort available Properties names in locale order and omit reserved keys.

The active-note view reacts to opens, leaf changes, metadata changes,
renames, and deletions. A deleted file may still be the active file until
its leaf closes, so clear the note on deletion. Emit only when the note path
or Item key changes, and keep key-only consumers stable across a rename.
Plain Literature Note and link resolution reads frontmatter directly so
they work before the scan. Convert YAML Date values at the host edge.
Parse timestamps with offsets directly and interpret a datetime without
an offset in the local timezone.

Fixtures model cold startup and runtime enablement, including the
Metadata Cache listener's registration order. Recursive Properties can
fail serialization and later input still needs to reach the consumer.
The event benchmark measures the real Note Index over 50,000 events per
burst, with acquisition and assertions outside the timed work.
[Note Index](../../packages/plugin-services/src/obsidian/note-index/service.ts) · [Active note atoms](../../packages/plugin-services/src/obsidian/note-index/atoms.ts) · [Host fixture](../../packages/plugin-services/src/obsidian/note-index/__fixtures__.ts)

For worker log verification, mark the file end before refresh and wait
for its database-open record before counting worker-only debug categories.
Debug includes snapshot and Item Index records. Info keeps the open
record and drops debug output. Repeat the refresh while the new level
propagates to the worker.

Rename the saved destination while the plugin is disabled in the
startup-scan test. This makes startup reconcile the saved setting
instead of handling a live rename event.
[Fresh destination case](../../packages/e2e/src/fresh-destination.e2e.ts)
