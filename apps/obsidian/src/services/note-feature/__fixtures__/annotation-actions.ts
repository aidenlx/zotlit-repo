// Real insertion flow over an in-memory Zotero database and a controllable Template.
import { Effect, Layer } from "effect";
import { stubService } from "@/lib/__fixtures__/service-stub.ts";
import { AnnotationRepository } from "@/services/annotation-repository/service.ts";
import { ExcerptPreparation } from "@/services/excerpt-image/prepare.ts";
import { NoteIndex } from "@/services/note-index/service.ts";
import { profileReader } from "@/services/profile/__fixtures__/reader.ts";
import { Profile } from "@/services/profile/service.ts";
import { defaults } from "@/services/settings/schema.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import { Template, templateFailure } from "@/services/template/service.ts";
import { UseLedger } from "@/services/use-ledger/service.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service.ts";
import { layerRcRef } from "@/services/zotero-reads/connection.ts";
import { layerZoteroReads } from "@/services/zotero-reads/service.ts";
import { inProcessClient, memoryOpener } from "@/services/zotero-reads/test-utils.ts";
import type { AnnotationInsertRequest } from "@/services/note-feature/insert-action.ts";
import type { AnnotationInsert } from "@/services/note-feature/insert-annotation.ts";
import { AnnotationNoteActions, layerAnnotationNoteActions } from "@/services/note-feature/view-actions.ts";

const SEED = `
insert into version (schema, version) values ('userdata', 129);
insert into libraries (libraryID, type) values (1, 'user');
insert into settings (setting,key,value) values ('localAPI','serverID','SERVER000001');
insert into items (itemID,itemTypeID,dateAdded,dateModified,libraryID,key) values
  (1,1,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RUGIER24'),
  (2,2,'2025-01-01 00:00:00','2025-01-01 00:00:00',1,'RGRPDF24');
insert into itemAttachments (itemID,parentItemID,linkMode,contentType,path)
values (2,1,0,'application/pdf','storage:paper.pdf');
`;

export function annotationAction(
  request: AnnotationInsertRequest,
  render: Effect.Effect<AnnotationInsert, unknown>,
  services: {
    repository?: AnnotationRepository["Service"];
    ledger?: UseLedger["Service"];
    serverID?: string;
  } = {},
) {
  let summary: AnnotationInsert["summary"] = { zotero: 0, unchecked: 0, unavailable: 0 };
  const dependencies = Layer.mergeAll(
    layerZoteroReads(inProcessClient(layerRcRef(memoryOpener(() => SEED.replace("SERVER000001", services.serverID ?? "SERVER000001")).open))),
    Layer.mock(ZoteroPref, { current: Effect.succeed(stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir: "/zotero", baseAttachmentPath: null })) }),
    Layer.mock(PluginSettings, { current: Effect.succeed(defaults) }),
    Layer.mock(NoteIndex, { getNotesByItemKey: () => Effect.succeed([]) }),
    Layer.mock(Profile, { profileOf: (file) => Effect.sync(() => profileReader().profileOf(file)) }),
    Layer.mock(ExcerptPreparation, { forCard: () => Effect.succeed({ helper: null, summary: () => summary }) }),
    Layer.mock(Template, {
      renderProfileAnnotation: () => render.pipe(Effect.map((result) => { summary = result.summary; return result.text; }), Effect.mapError((error) => templateFailure(error))),
      renderCitation: () => Effect.succeed(""),
    }),
    services.repository ? Layer.succeed(AnnotationRepository, services.repository) : Layer.mock(AnnotationRepository, {}),
    services.ledger ? Layer.succeed(UseLedger, services.ledger) : Layer.mock(UseLedger, {}),
  );
  return Effect.flatMap(AnnotationNoteActions, (notes) => notes.insert(request)).pipe(
    Effect.provide(layerAnnotationNoteActions.pipe(Layer.provide(dependencies))),
  );
}
