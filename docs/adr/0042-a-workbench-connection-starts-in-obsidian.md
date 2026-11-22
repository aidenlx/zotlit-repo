---
status: superseded by ADR-0100
---

# A Workbench Connection starts in Obsidian

> **Superseded by [ADR 0100](0100-the-web-template-workbench-is-retired.md).** The Local Bridge and the Workbench Connection are removed.

> Current release scope is amended by [ADR 0046](0046-customize-is-a-chooser-between-the-web-workbench-and-the-profile-editor.md#current-release-amendment--2026-09-08): the Local Bridge is behind a build flag that defaults to off. Local Server settings and Live Update remain available; bridge controls are hidden and bridge requests are rejected while the flag is off.

The [#947](https://github.com/aidenlx/zotlit/issues/947) contract carried two bootstraps for the web Template Workbench: Obsidian-first, where the page receives a one-time code in the URL fragment, and browser-first, where the page probes a fixed loopback port and waits for approval in Obsidian. The Fixture mock auto-approved the probe, so the `pending` state was never exercised, and every real user path starts from a Customize action in Obsidian. Decided in the Local Bridge grilling on map [#835](https://github.com/aidenlx/zotlit/issues/835): a Workbench Connection starts in Obsidian only. The plugin mints a Connection code, opens the docs site with the code and the Local Server's port in the fragment, and the page exchanges the code for a session credential; the page's disconnected state tells the user to open the Workbench from Obsidian, and reconnection after a reload resumes on the kept credential and port. The Local Bridge is hosted on the plugin's one Local Server beside Live Update, on the configured server port with a fallback range for a second open vault. The session credential lives in plugin memory only, so plugin unload, Obsidian quit, disconnect, or a newer approval revokes it; there is no secret at rest on either side.

## Considered options

- **Keep both bootstraps**: a dormant probe endpoint that still has to be defended and a Connect button the page cannot honour when Obsidian is closed.
- **A separate bridge listener on a fixed port**: two servers with two lifecycles and a second port collision between open vaults, for a page that already learns the port from the URL.
- **A per-device session store with an expiry**: lets an open tab survive an Obsidian restart without a click, at the cost of a credential at rest; the per-device "do not ask again" flag on the launch sheet removes the friction that store would buy.

## Consequences

- The bridge contract moves to version 2: the probe path and the `pending` state are removed, the selected Item becomes nullable, the fragment carries the port, and the kept credential records its port.
- Live Update and the Local Bridge share one Hono app and one settings group: a server toggle and one toggle per hosted service. Bridge routes refuse non-loopback peers and emit CORS headers only for the docs origins, whatever address the server is bound to.
- The Fixture mock follows the contract bump and keeps serving the docs app's tests; the plugin's bridge is tested through the same Hono app seam and the end-to-end run.

## Web connection lifecycle

Start the fragment exchange once per page because a React mount can replay. On reload or after a transient transport failure, present the tab's credential and port to the current bridge and check the grant against the bridge's current versions and capabilities. An explicit Disconnect drops the local credential even if the vault does not answer. If the vault misses the disconnect, the user can revoke the session in Obsidian. A new connection then requires a launch from Obsidian.

Scope vault reads to their connection and state subscriptions to the page. Disconnect closes the old read scope and opens a fresh scope for the next connection. Closing the page ends both the reads and subscriptions.

Hydration publishes the opened Profile and the resources that belong to it together. Load the launch Item before exposing Restore so a late response cannot overwrite the restored sample. Without a granted Item, use the built-in sample. Initialize the document from the vault's effective defaults. Hydration reads the vault's default citation style first, and the document's style binding then drives later reads. If the bridge cannot list citation styles, use the citation style ID input. A transport failure still ends hydration.

Keep a restored or in-memory draft tied to the revision it came from. A refresh can open newer vault source and offer the kept draft, but saving that draft still checks its original revision before writing.

Read dependencies for the current source before compiling it. Reuse the bundle when the set of partials stays the same. If that set changes, suspend rendering until the replacement arrives. A newer dependency request or citation style request interrupts the older request of the same kind. If a connected dependency uses Eta, open the handoff screen. If the bridge declined to provide that partial, use its diagnostic to identify it.

The page accepts each hydration once. It waits until the hydrated Profile opens before starting follow-up reads tied to the draft on screen. Apply the opened source and sample in one atom batch so the restore prompt measures a consistent starting state. On Reconnect to the same vault installation and document reference, preserve the source and undo history and update the saved baseline from the vault. Explicit Reload replaces the source. [Failed Reload follow-up](https://github.com/aidenlx/zotlit-repo/issues/120)

## Local Server ownership and listener lifetime

Use one Hono app for Live Update and the independently mounted services.
Mount each route group for the plugin's lifetime and apply its own toggle
to requests. Live Update gates only its own routes. The server switch
controls the listener. A change to the Live Update switch leaves the
bound port alone, so the Workbench keeps its connection.

Bind from the configured port and try up to ten consecutive port numbers
within the TCP range. Retry only when a port is in use, so invalid bind
options do not repeat across the range. Settle the bind result for
synchronous start errors as well as asynchronous listener errors so unload
can finish. Report the listener down when its active server emits an error.
Keep the native window Request and Response classes. WebAssembly streaming
checks the native Response, and replacing it prevents the Pandoc engine
from starting.

Replay the current settings on subscription to perform the initial bind.
Handle later changes serially, including stop and rebind. On disposal,
stop the settings consumer first and wait for a bind in progress before
closing its listener. Tests use a held port without requiring a specific
neighbor and explicitly close held client connections before disposing
the listener.

Show listener controls, the bound port, and hosted service rows on the
Advanced page. Each hosted service supplies its own rows through the
settings slot. Put the Live Update switch next to Companion setup on the
Zotero page. Keep the switch's value when turning off the server. Use
the listener and settings streams together to show availability because
another surface can start the server and because the bind can fail.
[Local Server layer](../../packages/plugin-services/src/desktop/local-server/layer.ts) · [Local Server settings](../../packages/plugin-services/src/obsidian/local-server/settings-rows.ts)

## Browser client contract

Keep the grant and effective Local Server port together in the browser
tab's session storage. A reload uses that port because another vault can
bind a different port in the configured range. Without a saved grant,
show the Open from Obsidian guidance. If the platform blocks access to
session storage, use a storage implementation that discards writes.
Close client subscriptions with the page Scope.

On resume, ask the bridge for its current versions and capabilities.
A transport failure keeps the grant for a retry. A revoked grant or
incompatible bridge clears it. Disconnect clears local state even if
the request fails. Do not send trace propagation headers because the
browser's preflight accepts only the bridge's declared request headers.
A refused Save remains a response for the page to show. A malformed
launch fragment stops before sending a request.

Use the same development origin for the docs page, bridge allowlist, and
Fixture. Return the vault's effective sparse Profile bindings so the
page can display and override the right defaults. A launch with no Item
uses a Sample Item. Resolve each dependency bundle for the exact draft
request so Preview uses the partials that draft calls.
[Browser client](../../packages/workbench/src/bridge/client.ts) · [Bridge contract](../../packages/workbench/src/bridge/contracts.ts)

During a draft repair, keep the last valid Shared Partial dependency
list so Preview retains its bundle. Include only names that a partial
file can answer.
[Document dependency list](../../packages/workbench/src/document/controller.ts)
