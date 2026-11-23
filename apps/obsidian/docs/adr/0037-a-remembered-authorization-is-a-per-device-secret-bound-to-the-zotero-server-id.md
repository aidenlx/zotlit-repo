# A Remembered Authorization is a per-device secret bound to the Zotero Server ID

A Zotero local API key is a broad local write credential: unscoped across every editable local library, unrelated to zotero.org keys, and single-use unless the user picked Always Allow. We keep a Remembered Authorization in Obsidian's SecretStorage under the id `zotlit-zotero-write-authorization`, as one record `{ version, serverID, key?, confirmed? }` bound to the Zotero Server ID that granted it. `confirmed` records the researcher's confirmation in Obsidian ([ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md)); a key without it is held unused. SecretStorage is per vault and per device, encrypted through the OS keystore where one exists, and visible to the user in Obsidian's Keychain settings with last-access time and a delete button — so the credential lives where Obsidian says secrets go, never in synced `data.json`. The typed API has no delete, so invalidation overwrites the record with a keyless one; the reader accepts that shape and an unknown version as "no record".

## Considered Options

- **Plugin settings or the Device Override localStorage path** (rejected): the same per-device storage class, but no encryption and no user-visible place to see or remove the key.
- **Feature-detect Obsidian's undeclared `deleteSecret`** (rejected): removes the lingering keyless record from the Keychain list, at the cost of a second code path over an API the typings do not declare. Keyless overwrite alone is enough.
- **SecretStorage, one server-bound record, keyless overwrite** (chosen).

## Consequences

- The record is read fresh from SecretStorage at each write with `getSecret`, never cached, so a key the user deleted in Keychain is simply "no record" at the next write and no event dependence exists.
- A remembered key has no validation route; it is a candidate until a write succeeds. A `401` overwrites the record keyless and returns the session to "authorization required".
- A Capability Probe that returns a different Zotero Server ID leaves the record alone; only a new Always Allow replaces it, so switching back to the original database keeps editing without a dialog.
- Every vault authorizes on its own under the one Client Name, so Zotero holds one remembered key per vault. Zotero shows only a count and one "Clear Write Authorizations" button.
- Where Obsidian has no OS keystore it stores secrets as plain text and warns the user itself; ZotLit stores the record anyway, since the key only permits writes to a database every local process can already read.
- The client reaches the store through an injected credential-store port, the same seam pattern as its transport, so the state machine tests against an in-memory store.

Choose one stable Keychain entry ID and one Client Name across vaults.
The ID uses lowercase alphanumerics and dashes. The test pins the ID
independently so a rename cannot silently lose access to existing keys.
Bind the stored grant to Zotero's per-database server ID and use
SecretStorage to take advantage of the OS keystore where available.
Zotero's Local API key uses the same alphanumeric alphabet as its server
ID.

Read the Keychain fresh for every write. Leave a usable grant for a
different database in place so switching back avoids a new dialog. The
settings row can forget the current grant even when Zotero is closed.
Overwrite an existing record with a keyless record because the typed
SecretStorage API exposes no delete. An empty store needs no write. A
newer or unreadable record behaves as absent. Track the version in the
persisted format registry. If the Keychain refuses a grant write, leave
the grant unused.
[Authorization store](../../../../packages/plugin-services/src/obsidian/zotero-local-api/write-authorization.ts)

The in-memory fixture follows the same database binding. It records
writes separately so tests can distinguish a keyless overwrite from
leaving the prior record in place.
[Credential fixture](../../../../packages/plugin-services/src/obsidian/zotero-local-api/__fixtures__.ts)
