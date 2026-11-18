// Renders an Annotation's page-pinned citation for the annotation view's "Copy citation".
import { Effect } from "effect";

import type { AnnotationCitation } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import {
  buildAnnotationsTemplateData,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import {
  annotationCiteRefs,
  buildAnnotationResolvers,
} from "#desktop/template/annotation-render.ts";
import { Template } from "#obsidian/template/service.ts";

/**
 * Render an Annotation's page-pinned citation: the same Citation Template path
 * the `zt.citation` field uses ({@link annotationCiteRefs}), from one
 * `AnnotationSources` read in one Snapshot. A citation string imports no file,
 * so the resolvers' `attachmentImport` port blocks every source.
 *
 * @param annotationKey the Annotation's Indexed Key.
 */
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
  const { dataDir, baseAttachmentPath } = yield* (yield* ZoteroPref).current;
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
