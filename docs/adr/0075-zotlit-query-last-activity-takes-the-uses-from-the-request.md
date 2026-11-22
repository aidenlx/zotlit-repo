---
status: proposed
---

# ZotLit Query's last activity takes the Uses from the request

Amends [ADR 0071](0071-zotlit-query-is-one-command-over-three-datasets-with-relation-lists.md). Decides part of [#1532](https://github.com/aidenlx/zotlit/issues/1532).

## Decision

- Item Query has the field `lastActivity`: the newest of the `lastRead` of the Item's Attachments, its `dateAdded`, the newest `dateModified` of its child notes and Annotations, and its last Use. Attachments gain the field `lastRead`, and Items its maximum over their Attachments, as `lastRead`.
- The engine cannot see the vault, so a request carries the Uses: at most a few hundred `Indexed Key → instant` pairs from the plugin's Use Ledger. A request without them computes `lastActivity` from Zotero alone.
- The field `lastActivitySource` names the winning signal: `read`, `note`, `annotation`, `added`, or `use`. A Zotero tie keeps the read, then the note edit, then the addition; a Use wins a tie. A host words the reason from it and asks its ledger only for the kind of a `use`, so the engine is the one place that chooses.
- `lastActivity` is a Sortable Field, the second exception after the First Author to the rule that a value derived from a Relation List is projection only. The item search index orders its empty query by the same value, so the quick switcher, the Citation Suggester, the pickers and Recent share one order.

## Why

The alternative, ordering by Zotero activity in the engine and merging the Uses in each host, is correct only if each host runs a second query over the ledger's keys and merges the two lists before cutting to `limit`. Every consumer (the item index, the Query View, the `zotlit query` command) would carry its own copy of that merge. The Uses are small, need no metadata cache, and change rarely enough to be sent with each request, so the engine computes the whole value once.

Unlike vault properties ([apps/obsidian ADR 0070](../../apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md)), which need the vault's metadata cache and stay outside the engine, the Uses are plain data.

## Consequences

- The Use Ledger is per device ([apps/obsidian ADR 0079](../../apps/obsidian/docs/adr/0079-the-use-ledger-is-device-local.md)), so the same Query File sorted by `lastActivity` can order differently on two devices. The field description says so.
- A new Use invalidates cached results as a database change does.
- Item `dateModified` is no part of `lastActivity`; it stays a field of its own.

Equal Zotero timestamps keep the signal encountered first. The order is Attachment read, Child Note edit, Annotation edit, then Item addition. An explicit Use wins a tie so the result identifies the Obsidian action. Only Item Query exposes fields that read Uses from the request.

A new recorded Use invalidates open Query Views so a Last Activity sort reflects the current ledger. The subscription emits subsequent changes and skips its initial snapshot.

Exercise Uses through note navigation, Recent, empty search, and the
Query CLI. A dismissed chooser leaves typed input intact. A successful
Citation insertion or Library row drag records a Use. Annotation follow,
row selection, and the Reading Card do not. A document's cited Item
leads the empty suggester even when another Item has a newer Use.
Wait for the Document Citation Set before checking that priority.
Invoke the registered Companion URI handlers to exercise its update
navigation without activation. Verify that an already-open tab can
be made active again without losing its order.
[Recent Use cases](../../packages/e2e/src/recent-uses.ts)
