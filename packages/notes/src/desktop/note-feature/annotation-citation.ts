import { Effect } from "effect";

import type { AnnotationCitation } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import {
  buildAnnotationsTemplateData,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  annotationCiteRefs,
  buildAnnotationResolvers,
} from "#desktop/template/annotation-render.ts";
import { Template } from "#obsidian/template/service.ts";

export const renderAnnotationCitation = Effect.fn(
  "NoteFeature.renderAnnotationCitation",
)(function* (annotationKey: string) {
  const sources = yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const libraries = yield* reads.Libraries({});
      const selector = resolveIndexedKeyLibraryIn(libraries, annotationKey);
      return selector
        ? yield* reads.AnnotationSources({
            libraryID: selector.libraryID,
            keys: [selector.key],
          })
        : null;
    }),
  );
  const { dataDir, baseAttachmentPath } = yield* libraryFilePaths;
  const resolvers = buildAnnotationResolvers({
    zoteroPref: { dataDir, baseAttachmentPath },
    attachmentImport: {
      decide: (path, origin) => ({
        approved: false,
        path,
        origin,
        reason: "no-trusted-root",
      }),
      resolveLink: () => () => "",
    },
  });
  const [data] = sources
    ? buildAnnotationsTemplateData(sources, resolvers).values()
    : [];
  if (!data) return { kind: "not-in-database" } satisfies AnnotationCitation;
  const refs = annotationCiteRefs(data.parentItem, data.pageLabel);
  if (!refs) return { kind: "no-citation-key" } satisfies AnnotationCitation;
  const text = yield* (yield* Template).renderCitation(refs, "main");
  return { kind: "citation", text } satisfies AnnotationCitation;
});
