---
status: accepted
---

# The Companion observes reader focus and selection at their source

A Zotero reader can be a main-window tab or a top-level window. Subscribe to tab selection for the tab path. Subscribe to DOM activation on reader windows and main windows for the window path. Returning to a main window can focus its already-selected reader without another tab change. Track new windows through the window mediator and check the reader as it loads because its activation may have fired by then. At startup use the current focus or mediator recency. A reader window supplies a back-reference after the reader loads. [Zotero reader windows](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/reader.js) · [Zotero tab notification](https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/tabs.js)

Deduplicate by attachment and emit one inactive event on departure. The receiver can keep the last attachment visible and indicate that the reader has closed. Store activation teardown in a weak map keyed by window. During disposal, enumerate live windows and detach their listeners. Drop the entry for a closed window without calling its DOM methods. A load callback may still run after teardown and checks the disposed flag before attaching.

The reader iframe holds the authoritative selected annotation keys. A sidebar MutationObserver missed deselection when the sidebar was hidden. Wrap the reader's state update method, call the original first, and read the resulting selection without changing reader state. Assign the wrapper directly because prototype reparenting crosses the Gecko chrome/content boundary and can break the reader. Map keys to sorted item ids for the wire payload. Seed the signature from the initial selection and send the full set when it changes. Sweep all tab events since a restored reader can instantiate on the load event without an add or select. Deduplicate concurrent initialization and restore the original method on rebind or disposal. [Reader state implementation](https://github.com/zotero/reader/blob/9.0.4/src/common/reader.js#L493) · [Pending initialization follow-up](https://github.com/aidenlx/zotlit-repo/issues/91)

Keep observers registered. Read the master notification preference at dispatch so a preference change takes effect without rebinding. Dispose observers and window listeners on shutdown and development reload. The sender adds the protocol version and a source id derived from stable profile and data directory file URIs. The listener can filter notifications from other Zotero installs. Raw directory names travel only when debug logging is enabled. Notification errors should be isolated from the Zotero event that caused them. [Sender error follow-up](https://github.com/aidenlx/zotlit-repo/issues/92)

Indexed Key derivation rejects feed items because the key format has no feed-library selector. Its logger uses a rooted category so importing it does not construct the host's Localization object in tests.

## Reader state in Obsidian

Keep the current Reader Target in the Local Server. Views read the current
target on mount, then observe the stream. A target carries the parent Item,
attachment Item, and selected annotation Item IDs. Use the attachment ID
to distinguish a document switch from a selection update. Report reader
closure separately and keep the target when the reader goes inactive or
the listener becomes unavailable. A later reader push clears the closed
state. The Freshness Signal carries no data and asks subscribers to refresh.
[Local Server contract](../../packages/plugin-services/src/core/local-server/service.ts)

The Live Updates switch sits with the Companion on the Zotero page.
The server transports the notifications.

The Local Server owns one Hono application and one loopback listener.
Mount Live Updates once and gate the routes on their own toggle. The
listener setting opens the port. Serialize enable and address changes
with listener closure. Changing only Live Updates refreshes
availability while keeping the listener. The Advanced page exposes
the listener toggle and configured and effective addresses. The
Annotation View can enable the listener and Live Updates, so the
settings rows observe changes made elsewhere.
