// The view services a test host of this package leaves unread, so its registry
// context is whole. Each member dies when called. Only this package's tests
// read it: a host's program registers more view services.
import { Layer, Stream } from "effect";

import { layerUnreadKitViewServices } from "@zotlit/obsidian-kit/__fixtures__/view-atoms.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { CapabilityNotices } from "#obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { PdfAnnotationEditor } from "#obsidian/pdf-annotation-editor/service.ts";
import { ExcerptDisplays } from "#desktop/excerpt-image/display.ts";

/**
 * Every view service outside the Obsidian host tags, as an empty mock. Merge
 * it first: a service the test reads, merged after it, takes its place.
 */
export const layerUnreadViewServices = Layer.mergeAll(
  layerUnreadKitViewServices,
  Layer.mock(PdfAnnotationEditor, {
    sessions: Stream.make(new Map()),
    sessionAdded: Stream.empty,
  }),
  Layer.mock(
    ExcerptDisplays,
    stubService<ExcerptDisplays["Service"]>("ExcerptDisplays", {}),
  ),
  Layer.mock(AnnotationNoteActions, {}),
  Layer.mock(CapabilityNotices, {}),
  Layer.mock(AnnotationRepository, {}),
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
