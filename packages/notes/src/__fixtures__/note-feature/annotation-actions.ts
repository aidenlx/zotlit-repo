import { Effect, Layer } from "effect";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { profileReader } from "#__fixtures__/profile/reader.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { Template, templateFailure } from "#obsidian/template/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { inProcessClient, memoryOpener } from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import type { AnnotationInsertRequest } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import type { AnnotationInsert } from "#desktop/note-feature/insert-annotation.ts";
import { layerAnnotationNoteActions } from "#desktop/note-feature/view-actions.ts";

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
