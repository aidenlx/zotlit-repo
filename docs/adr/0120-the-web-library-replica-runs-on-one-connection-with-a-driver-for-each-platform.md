---
status: accepted
---

# The Web Library Replica runs on one connection, with a driver for each platform

Amends [ADR 0119](0119-the-online-library-is-a-web-library-replica-in-opfs.md): the desktop stack, the two connections of the apply, and the place of the replica file. Decided in issue #320.

## Context

ADR 0119 runs the replica on `@sqlite.org/sqlite-wasm` with the `opfs-sahpool` VFS on desktop and on Mobile. Since #308, one Worker holds a read connection and a write connection to the one file. Readers read the committed replica during an apply until the changed pages pass a budget of 32 MiB; after that point, new reads wait until the commit.

The Zotero clients make no search wait for a sync. Zotero desktop has one SQLite connection and runs reads between write transactions of at most 50 objects (`xpcom/db.js`, `xpcom/sync/syncLocal.js`). Zotero for iOS and Android read Realm snapshots, and each write holds at most 50 items. In each client, a reader can see part of a sync. ZotLit keeps its own rule: a reader never sees part of a library version.

## Decision

- **One connection for each replica, on each platform, during the beta.** The apply stays one transaction in time slices. It begins only when no borrow is held, and readers wait in the read gate from `begin` to `commit`. The status, the replica language and the source identity answer from memory during an apply. A failed rollback closes the handle and opens the file again once no borrow is held (SQLite rolls back the journal at the open), so the last good replica stays readable. The second connection hid a slow apply on desktop, where most development and testing happen. With one connection, each slow apply is a wait that the developers feel, so the sync must be made fast, on Mobile too. A return to two connections is a decision for after the beta. The two-connection code is removed; commit `2b50d1c17` holds it.
- **A driver for each platform.** Desktop uses `node:sqlite` on a file, in a desktop-only Worker root. Mobile uses `sqlite-wasm` with `opfs-sahpool`, in the web root. A development setting starts the web root on desktop, so the Mobile path runs on the desktop host. Desktop does not read the `sqlite-engine` Pack Entry.
- **A Replica Store holds the storage rules.** It is one module in the Worker zone. Its interface:
  - `open`, `borrow` (the committed state; it waits while the replica loads, while an apply runs and while a recovery runs), `stage` (one short transaction of the download) and `apply` (one transaction in slices, with progress; the result says whether readers see a change).
  - `downloadEnded` (the caller says that a download ended or stopped; the store runs its checkpoint), `libraries` (the last commit: the libraries that an apply committed, the replica language and the identity), `empty`, `remove` and `databaseGeneration`.
  - `report()` gives the state, the last commit, the times of the last apply, a problem of the replica file and whether an apply waits for readers.

  The store keeps one state value: `closed`, `open`, `applying`, `publishing` (committed, not yet published), `recovering` (after a failed rollback) or `unavailable`. A commit is published in one uninterruptible step before any read is admitted: a renewed client, the last commit read again, and the change event. If the renewal fails, the store opens the file again and then publishes. If that fails too, the store becomes `unavailable`; it never rolls back committed data. While it is `recovering`, it admits no new borrow. Each move to `unavailable` tells the source machine (`open-failed`) once. The machine of `layerWebApiSource` stays the judge of loading and degraded: the store reads it through a `SubscriptionRef`. The sync code keeps the plan, the consent, the state machine and the download.

- **A Replica Driver is the seam under the store.** It gives `open(file)` (one `ZoteroDatabase`), `inTransaction()`, `checkpoint()`, `remove(file)` (the file, its `-journal` and its `-wal`) and `renew()`. It has three adapters: wasm on OPFS, wasm on memory storage, and `node:sqlite` (in `packages/zotero-reads/src/desktop/`). The `open` of each adapter sets the pragmas of its platform:
  - First, on both: `locking_mode=EXCLUSIVE`, before any read and before a WAL is set, because `opfs-sahpool` has no shared memory.
  - Desktop: `journal_mode=WAL`, `synchronous=NORMAL` and a `journal_size_limit`. The store runs a truncate `checkpoint()` after an apply is published, while the read gate is still closed, and when a download ends or stops. Staging writes in between rely on the WAL auto-checkpoint and the size limit. A failed checkpoint keeps the commit served and readable. The status names it as a storage problem of the replica file, next to the outcome of the sync, until a checkpoint succeeds or the file is removed.
  - Mobile: `journal_mode=TRUNCATE` and `synchronous=NORMAL`. The replica has no WAL, so the `checkpoint()` of the wasm adapter does nothing. [Mobile journal mode](#mobile-journal-mode) gives the measurement.
  - Both: foreign keys off and temporary files in memory.
- **One folder for each vault.** All vaults of a device share one file system: the one OPFS of the Obsidian origin on Mobile, the user's disk on desktop. The replica of a vault is `zotlit/<app id>/zotero-replica.sqlite` under the root of its platform: the OPFS root, or Obsidian's user-data folder on desktop (`electron.remote.app.getPath("userData")`). The app id is the vault ID of Obsidian's vault registry. The desktop folder is outside the vault, so a vault sync tool never copies an open database. Exclusive locking stops a second process that opens the same file. In OPFS, the pool folder holds opaque slot files, and the replica is a name inside the pool. On desktop, **Remove online library data** removes the folder of this vault: the Worker closes the replica first, and the next sync creates the folder again. The removal uses the checks of the removal for other vaults: the vault ID has Obsidian's form, and `zotlit` and the folder are real folders, not links.
- **Work that the user starts comes first.** A batch update of notes, a query export, a batch import, the `Snapshot` RPC and the stream RPCs keep their borrow to the end, and a sync waits for them. The Citation Lookup build and the item index scan take one borrow for each window or page, so a sync can run between them. A build that sees a new client discards its work and starts again, so it never publishes a mix of two library versions.
- **A progress notice for a long sync.** A sync that runs for more than 2 s shows a Notice with the progress of each phase. During the download it has a "Stop sync" button, and the staged data stays for the next sync. During the apply it has no button and says that searches wait until the update is done. While the apply waits for work that the user started, it says so. The notice uses the native notice parts of `@zotlit/obsidian-kit` (a title, text lines, a progress bar and buttons).
- **Performance guards.** `pnpm verify` runs count guards at the interface of the Replica Store: statements and changed rows for each `apply` and `stage`, on seeds of 5,000 and 50,000 items, on the `node:sqlite` adapter and the wasm memory adapter, against committed baselines with a stated margin. Time limits follow [ADR 0116](0116-e2e-timing-limits-use-a-reference-machine.md): ordinary E2E reports the times, and `pnpm e2e:performance` enforces them on the reference MacBook. The targets:

  | Case                                                          | Desktop (`node:sqlite`) | Mobile (wasm) |
  | ------------------------------------------------------------- | ----------------------- | ------------- |
  | Daily sync, at most 100 changed items: longest wait of a read | 100 ms                  | 250 ms        |
  | 5,000 changed items: apply time                               | 500 ms                  | 1.5 s         |
  | First build of 50,000 items: apply time                       | 3 s                     | 10 s          |
  | Status answer during an apply                                 | 50 ms                   | 50 ms         |

  The longest wait of a read is the time that the gate is closed with no long borrow held. Each target gets a measured baseline before the optimization. No reference device exists for the Mobile column: until one exists, the Mobile column is measured on the wasm root on OPFS on the reference MacBook, and a separate ticket finds a way to measure on more devices than one Mac.

- **Data of a vault that is gone.** A vault that leaves Obsidian's list, or gets a new vault ID, leaves its folder in place. An advanced setting removes such data by hand. It can remove only the data of this vault, or the data of other folders: desktop lists only the IDs that are not in Obsidian's `obsidian.json`, and Mobile lists each other folder, with a warning that another vault on the device can use it and will then download its online library again.

## Mobile journal mode

### Before the batched apply

Measured in #353 on the wasm root on OPFS, on the reference MacBook in the Run Container, with the cases of `online-library-sync.e2e.ts` (the sync cases of `pnpm e2e:performance`). The tree was the integration branch of #345 after #352 and #353 were merged. Each mode had one build and three runs, in the ordinary E2E run (no enforced limits). The runs of the three modes alternated, one at a time, while this ticket held the machine lock for timed runs. Another implementer used the machine at the same time. The third run of each mode started at a 1-minute load above 12 and was repeated once; the table uses runs 1, 2 and the repeat. Each cell gives the median and, after the slash, the maximum of the three runs.

| Target or value                                 | Limit  | `TRUNCATE`      | `PERSIST`       | WAL             |
| ----------------------------------------------- | ------ | --------------- | --------------- | --------------- |
| Daily sync of 100 items: longest wait of a read | 250 ms | 113 / 115 ms    | 110 / 112 ms    | 104 / 123 ms    |
| 5,000 changed items: apply time                 | 1.5 s  | 3.49 / 3.59 s   | 3.39 / 3.53 s   | 3.36 / 4.13 s   |
| First build of 50,000 items: apply time         | 10 s   | 20.76 / 21.18 s | 20.00 / 20.62 s | 21.55 / 24.01 s |
| Status answer during the first build            | 50 ms  | 55 / 74 ms      | 55 / 65 ms      | 132 / 361 ms    |
| Status answer during the 5,000-item apply       | 50 ms  | 46 / 88 ms      | 50 / 54 ms      | 45 / 87 ms      |
| Status answer during the daily sync             | 50 ms  | 60 / 60 ms      | 59 / 68 ms      | 57 / 59 ms      |
| First build: sync time                          | none   | 30.89 / 41.20 s | 29.09 / 29.79 s | 31.67 / 33.06 s |
| 5,000 changed items: sync time                  | none   | 5.85 / 5.99 s   | 5.57 / 6.04 s   | 5.46 / 7.56 s   |
| Daily sync: sync time                           | none   | 615 / 663 ms    | 601 / 619 ms    | 640 / 821 ms    |

Load average (1, 5, 15 min) before → after each run used: `TRUNCATE` 3.79 6.99 7.92 → 6.13 6.87 7.77, 3.96 4.89 6.25 → 8.80 6.27 6.62, 4.62 10.39 10.38 → 5.47 9.38 10.00; `PERSIST` 3.88 5.36 6.83 → 3.63 5.02 6.56, 3.91 5.26 6.15 → 9.44 7.29 6.88, 5.47 9.38 10.00 → 4.88 8.40 9.57; WAL 3.58 4.93 6.50 → 5.58 5.31 6.51, 9.36 8.54 7.59 → 22.52 14.14 9.90, 4.88 8.40 9.57 → 6.59 8.01 9.30. The repeated third runs started at 22.52, 27.39 and 12.58 (`TRUNCATE`, `PERSIST`, WAL). An earlier session on an older integration tree, with more load, gave the same order: WAL had a status answer of 137 to 174 ms during the first build, and `TRUNCATE` and `PERSIST` tied.

The runs had a 1-minute load between 3.6 and 22.5 (before and after the runs used), because other jobs ran on the machine. The difference between `TRUNCATE` and `PERSIST` is inside that noise.

- All three modes pass `web-api-crash.test.ts`, the Web API source suite and the count guards on memory storage. `TRUNCATE` and WAL pass the Replica Store suite. `PERSIST` fails one case of it through its fixture: `leaveSidecars` cannot create a `-journal` where `PERSIST` already kept one (`SQLITE_NOTADB`). The fixture was not changed, and the case was not run again.
- All three modes passed the case of `online-library-sync.e2e.ts` that stops the Worker during the apply of 5,000 changed items, on OPFS: the next Worker opens the file, and the old library is complete. The case that runs on both roots now (it stops the Worker when part of the apply is done) passed on the wasm root with `TRUNCATE`.
- WAL is rejected for the size of its status-answer delay during the apply of a first build. The longest status answer in runs 1, 2 and the repeated run 3 was 132, 118 and 361 ms with WAL, 53, 74 and 55 ms with `TRUNCATE`, and 65, 55 and 54 ms with `PERSIST`. All three modes are above the 50 ms limit in each run. WAL is slower than both other modes in each run, and more than twice the limit in each run. The import path of the wasm driver also turns WAL off. The pool slot count of WAL was not measured; it is an open point of #356.
- `TRUNCATE` and `PERSIST` tie: their difference on each target and on each sync time is inside the noise of the load, although the median sync time of `PERSIST` is lower in each case, in this session and in the first one. `TRUNCATE` is chosen because its journal file is empty after each transaction, so the pool keeps no copy of old pages on the device. A `PERSIST` journal keeps its largest size, which after a rebuild can be about the size of the replica; this size was not measured.
- **`TRUNCATE` is the mode for now.** #355 cuts the statements of the apply about 40-fold in the shared code, so file I/O becomes a much larger part of the apply. #356 repeats the comparison of the three modes on the optimized apply, with other jobs stopped, and may change the mode.
- **Chosen: `journal_mode=TRUNCATE`, set after `locking_mode=EXCLUSIVE`.** With exclusive locking the journal file stays in the pool, also after the replica closes. The pool uses 2 of its 6 slots: the replica and its `-journal`. The rebuild in a new Zotero language uses no more slots, and the `-journal` holds 0 bytes after a commit (the online library journey asserts both).
- The first-build and 5,000-item apply times stay above their limits in each mode; #356 owns them.

### After the batched apply

Ticket #356 repeated the comparison on the reference MacBook (Mac16,8), on the wasm Worker with real OPFS. The code was `6f2902442`, which combines the apply from #355 with the journal setting and recovery checks from #353. Only the journal pragma varied. All three modes used exclusive locking, normal synchronization and the same three enforced sync cases. WAL used its default automatic checkpoint. Each cell gives the three runs in order, in milliseconds. A run that started at a one-minute load above 12 was repeated once, and its repeat occupies that position.

| Measure (ms)                      | Limit (ms) |                 TRUNCATE |                  PERSIST |           WAL, exclusive |
| --------------------------------- | ---------: | -----------------------: | -----------------------: | -----------------------: |
| First build, 50,000 items         |      10000 |    3,299 / 3,507 / 3,295 |   4,311 / 12,888 / 3,617 |    5,000 / 3,086 / 3,215 |
| Apply 5,000 changes               |       1500 |          426 / 386 / 505 |        588 / 2,128 / 524 |          795 / 430 / 430 |
| Daily read wait, 100 changes      |        250 |             54 / 38 / 57 |             60 / 84 / 45 |            101 / 31 / 42 |
| Longest first-build status answer |         50 |            45 / 338 / 30 |           45 / 704 / 132 |          161 / 134 / 141 |
| Longest 5,000-item status answer  |         50 |             34 / 22 / 42 |            66 / 132 / 75 |            292 / 48 / 44 |
| Longest daily status answer       |         50 |             19 / 32 / 21 |             23 / 42 / 34 |             79 / 29 / 19 |
| First-build sync                  |          — | 12,124 / 15,213 / 11,647 | 17,869 / 34,817 / 16,041 | 16,257 / 11,176 / 11,728 |
| 5,000-item sync                   |          — |    2,880 / 2,749 / 3,311 |    5,269 / 6,740 / 3,246 |    4,322 / 2,725 / 2,752 |
| Daily sync                        |          — |          563 / 513 / 641 |        692 / 929 / 1,316 |        1,738 / 570 / 557 |

The median build times for TRUNCATE, PERSIST and WAL were 3,299, 4,311 and 3,215 ms. The median updates took 426, 588 and 430 ms. These differences were smaller than the run-to-run spread of PERSIST or WAL. The modes tie on apply speed within the observed variation. They ran in separate batches under different loads.

**Keep TRUNCATE.** It passed all six limits in two runs. In the third, only first-build status exceeded 50 ms. PERSIST exceeded 50 ms during all three 5,000-item updates. WAL exceeded 50 ms during all three first builds. TRUNCATE also leaves an empty journal after commit. The OPFS pool uses two of its six slots, one for the replica and one for its journal, including during a language rebuild.

| Mode     | One-minute load before → after each retained run |
| -------- | ------------------------------------------------ |
| TRUNCATE | 8.86 → 6.80 · 6.80 → 5.90 · 5.90 → 8.15          |
| PERSIST  | 8.15 → 19.13 · 14.79 → 26.24 · 30.07 → 23.75     |
| WAL      | 15.94 → 41.86 · 34.09 → 15.43 · 14.42 → 10.28    |

The store gives queued status requests a turn between the last write slice and commit. The read gate stays closed through publication and checkpoint. With TRUNCATE and this scheduling change, three enforced runs passed. First-build status took 32 / 32 / 31 ms, update status 37 / 36 / 21 ms and daily status 18 / 19 / 22 ms. The longest first build was 3,186 ms, the longest 5,000-item apply was 417 ms and the longest daily read wait was 55 ms.

## Considered options

- **Two connections in WAL on desktop.** Readers never wait, but desktop then hides a slow apply, which is the problem that this decision makes visible.
- **Short transactions of about 50 items, as in Zotero.** Reads never wait, but a reader sees part of a library version. #308 measured this shape: 794 reads of a partial state, and an apply 2.2 times slower.
- **`sqlite-wasm` on desktop too (ADR 0119).** Desktop proved the Mobile path, but desktop users needed the wasm from the Resource Pack, and desktop had no faster file storage.
- **The replica file in the plugin folder.** The plugin folder is in the vault, so Obsidian Sync, iCloud or Git can copy the database while it is open.
- **A vault stamp inside the replica.** It stops a read of another vault's replica only after someone renames or copies a folder by hand. The per-vault folder covers the normal cases.

## Consequences

- During an apply, every borrow waits. Before #355, the measured baselines on the reference MacBook were a median apply of 3.34 s for 5,000 changed items in 50,000 on the wasm root on OPFS (#349) and 3.44 s on the `node:sqlite` root (#352). A first build waits as before, because readers have no data until it ends.
- Each adapter runs the Replica Store suite and `describeDriverConformance`. The desktop runs prove the shared sync code, the wasm adapter with `TRUNCATE` on OPFS in Chromium (the development setting starts the web root on desktop, and the Run Container journey stops its Worker during an apply), and the Node tests on memory storage. They do not prove the Mobile host itself: its manifest, the WebView of Android and iOS, their OPFS and its quota, and a Worker that the system stops. These stay unverified until the check on a real Android or iOS device before each release.
- Other tools can open the desktop replica only while Obsidian is closed.
- With exclusive locking and `TRUNCATE`, the empty `-journal` file stays in the pool beside the replica.
- No migration: no release holds the replica of ADR 0119.
- The plugin builds one `main.js`, so it carries the web root and the desktop root. The manifest of the beta is desktop-only, and the web root starts on desktop only through the development setting. The desktop root adds 174,694 B to the production `main.js` (5,495,357 B before, 5,670,051 B after, measured in #352), and the `main.js` budget of ADR 0119 rises from 5,520,000 B to 5,700,000 B. Most of the added code is sync code that the web root in `main.js` also holds: the desktop Worker bundle carries the Web API source, the Replica Store, `@zotlit/web-library`, the replica code of `@zotlit/db` and `@zotlit/zotero-compat` as plain text, and the web root carries them deflated. Removing this duplicate is an open point for a separate ticket.
- ADR 0119 says that the pool uses its slots for the replica and its journal; the second slot is now the empty journal of the one connection (see [Mobile journal mode](#mobile-journal-mode)).
- These lines of ADR 0119 no longer hold. "Remove online library data deletes the pool directory": on desktop it closes the replica and deletes the vault's replica folder, so no replica file stays; on Mobile the Worker closes the replica and removes its file from the pool, and the next sync creates it again. "Where the bytes ship": desktop reads no `sqlite-engine` Pack Entry.
