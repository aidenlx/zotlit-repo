# The freshness push is a payload-free signal sent after the checkpoint

The Obsidian plugin needs to know when the Zotero database changed. The companion used to push a semantic `item/update` event at write time, carrying per-item add/modify/trash ids. The receiver discarded the payload entirely (every refresh swaps in a whole new snapshot client, so invalidation is always total), the event's trigger set (`item` only) was narrower than the checkpoint's write-trigger list, and its pre-checkpoint timing forced a numeric contract across two apps: Obsidian's immutable-watch debounce had to outlast the companion's checkpoint delay so a refresh would not read the stale main file.

We replaced it with the **Freshness Signal**: one payload-free `db/updated` event (protocol version 6) that the companion's freshness pipeline sends _after_ its debounced run settles — checkpoint first where the database uses a WAL, then the signal. Receiving the signal therefore implies the main database file is already as current as the companion can make it: the ordering is causal, not temporal, and the cross-app debounce contract is gone.

## Consequences

- The signal fails open: it follows write activity even when the checkpoint preference is off, the checkpoint failed, or the database uses a rollback journal (where commits land in the main file directly). A clone-mode reader still benefits in every one of those cases.
- The `notify` preference gates the signal; the `wal-checkpoint` preference gates only the checkpoint step. The two stay independent, and the Database Status control follows the checkpoint alone.
- A manual **Write Changes to Database File Now** also signals on `done` and `in-use` (a partial truncation may have moved frames), and stays silent on `failed` (nothing moved, a refresh would find nothing new).

## Companion checkpoint scheduling

Probe the journal mode at startup so WAL checkpoints run on Zotero 10 and on a Zotero 9 database that inherited WAL. A rollback-journal database and a failed probe leave the checkpoint inactive. The automatic path uses PASSIVE to move available committed frames without waiting for readers or writers. Immutable Source depends on the main database file, while WAL-aware snapshots can already replay committed frames. An unsuccessful automatic attempt records the result and leaves the pipeline armed for future notifier events. A busy manual attempt keeps the preceding status, even though the attempt can have moved some frames. Repaint listeners receive settled checkpoint attempts and their errors are isolated. A disposed automatic pipeline drops the signal from an in-flight checkpoint. [SQLite checkpoint modes](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint)

Watch item and collection activity, trash and group changes. Include both tag and item-tag because Zotero's bulk tag changes can bypass item saves. A 500 ms trailing debounce coalesces a burst and a 10 s ceiling gives continuous imports a chance to refresh. The test emits writes at intervals shorter than 500 ms on both sides of the ceiling to distinguish the ceiling from ordinary expiry.

Application Blur can flush a pending run sooner. Read the focus state after a Window Deactivate callback returns because the synchronous state can still refer to the old window. Multiple windows may report one blur, so consumers treat it as idempotent. A native modal can delay the window timer. Modals opened from readers, the modal-open race, and some multiple-main-window configurations can miss the early flush. The trailing timer remains the fallback. Dispose listeners only on live windows because closed Gecko window objects are unsafe to access.
