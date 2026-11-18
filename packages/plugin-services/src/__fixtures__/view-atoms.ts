// The view services a test host of this package leaves unread, so its registry
// context is whole. Each member dies when called. Only this package's tests
// read it: a host's program registers more view services.
import { Layer } from "effect";

import { layerUnreadKitViewServices } from "@zotlit/obsidian-kit/__fixtures__/view-atoms.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { LocalServer } from "#core/local-server/service.ts";
import { QueryClients } from "#core/query-client/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { ItemLookup } from "#obsidian/item-lookup/service.ts";
import { LibraryScope } from "#obsidian/library-scope/service.ts";
import { NoteIndex } from "#obsidian/note-index/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";
import { UseLedger } from "#obsidian/use-ledger/service.ts";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadKitViewServices,
  Layer.mock(LocalServer, {}),
  Layer.mock(ItemLookup, {}),
  Layer.mock(NoteIndex, {}),
  Layer.mock(LibraryScope, {}),
  Layer.mock(UseLedger, {}),
  Layer.mock(PluginSettings, {}),
  Layer.mock(QueryClients, {
    client: stubService<QueryClients["Service"]["client"]>("QueryClient", {}),
  }),
  Layer.mock(ZoteroPref, {}),
  Layer.mock(ZoteroReads, {
    reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
  }),
);
