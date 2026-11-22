# The Use Ledger is device-local

The Use Ledger, which records the last Use of each Item for Last Activity, lives in the vault's local storage on each device, beside the Device Overrides, and never syncs. A Use happens often, at every note open and tab return. In plugin data, each one would rewrite the settings file, and two devices that sync the vault would race on that whole file, so a ledger write on one device could undo a setting changed on the other. What matters most across devices is reading, and it already crosses devices through Zotero: `lastRead` syncs with the Zotero library, and a read in Obsidian's PDF view reaches it through write-back when the researcher has granted Write Authorization ([#1533](https://github.com/aidenlx/zotlit/issues/1533)).

Proposed on 2026-10-19 with [#1532](https://github.com/aidenlx/zotlit/issues/1532).

## Considered Options

- **Plugin data (`data.json`), synced with the vault** (rejected): what [#1532](https://github.com/aidenlx/zotlit/issues/1532) and [#1533](https://github.com/aidenlx/zotlit/issues/1533) first assumed. Every Use would rewrite the settings file and race with settings changes on other devices.
- **A file of its own in the plugin folder** (rejected): it avoids the settings race, but two devices still overwrite each other's whole ledger, and whether vault sync carries the file depends on the sync service.
- **Vault-scoped local storage, per device** (chosen): no sync race and no settings migration, and the same storage the Device Overrides use.

## Consequences

- A Literature Note opened or a citation inserted on one device does not move the Item in Recent on another; reading in Zotero, or in Obsidian with write-back, does.
- A new device starts with an empty Use Ledger; Zotero activity orders its list until Uses accrue.
- The ledger has no settings schema entry, version or migration.

A restored Reader tab records no use for startup or for moving to its saved page. The same applies after a vault modification reloads its PDF. Record a later page turn or explicit link navigation. Record an explicit open for a different Attachment even if its PDF is already open.

Record Reader closure on workspace close or file replacement. Dispose the binding separately during plugin teardown.

Throttle page events for five minutes per database and Attachment across Reader views. Open and close events bypass the page throttle. Skip standalone Attachments with no parent item. Preserve the original open instant if Attachment resolution waits.

## Local activity and storage

Keep only the newest Use for each Indexed Key and the 300 most recent Items.
Keep the existing storage key and Temporal ISO timestamp format so older
saved Uses still load. Expose the recorded instant for live read write-back,
and send epoch milliseconds to the query worker and empty Item search.
Save before publishing the next state so a write failure leaves the prior
ledger available to callers. Load valid entries and skip unreadable ones.
If storage access throws during startup, log it and start with an empty
ledger.

Record opens only after layout-ready and consume native file-open events
without replaying the already-active file. When an open arrives before
its cache entry, use its original timestamp if the file is still active
when metadata arrives. Flush deferred native opens before and after
suppressing Companion update navigation. Feed file-open events to the
ledger in the host callback so earlier unrelated opens keep their Use and
excluded opens stay inside that exclusion. Close recording before teardown
and end the replayable state stream with the layer.
[Use Ledger](../../../../packages/plugin-services/src/obsidian/use-ledger/service.ts)

Write back only the live read, and only when its resolved Zotero Server
ID matches both the authorized Local API and the current database
snapshot. Skip group Attachments. Log a failed write-back without
failing the local Read Use. The recorded test fixture accepts an absent
lastRead before the first read and numeric Unix seconds afterward.
Keep the test object version distinct from the Library version so it
checks which value the write sends.
[Read write-back](../../../../packages/plugin-services/src/obsidian/zotero-local-api/last-read.ts)

Serialize read write-backs for the same database and Attachment. Other
targets can proceed independently. Hold the database identity across the
credential read. Run the work on the session Scope with a deadline, so
a caller leaving still lets the write-back settle. Drop a queue when no
operation uses it and do not replay completed or failed Uses. Distinguish
ending before the GET, interrupting the GET, and interrupting after a
PATCH may have landed. Background refusals update session state without
showing edit notices. [Write-back session](../../../../packages/plugin-services/src/obsidian/zotero-local-api/session.ts)

### PDF read proof

A retained PDF binding keeps the source that resolved its Attachment.
Keep Zotero and the client alive until the close write-back decision is
traced. Then check the external record so a switch to another
database's identity cannot hide behind an unfinished write.

Observe both the ledger and Recent order during real navigation. Check
that restoration and page rendering do not count as read gestures, and
that a standalone PDF has no Item to record. Turn a restored reader's
page to check that it still records real transitions with a fresh
plugin throttle history. Reload the plugin after changing the
Attachment in the database so the check uses the new path index.

[Source retention](../../../../packages/e2e/src/pdf-read-source.ts) ·
[PDF read cases](../../../../packages/e2e/src/pdf-reads.ts)

When checking the Zotero Last Read write, wait for both the
value and its version to change. Zotero's Local API can expose
the in-memory value at the previous version before commit.

[Paired Last Read proof](../../../../packages/e2e/src/paired-run.e2e.ts)
