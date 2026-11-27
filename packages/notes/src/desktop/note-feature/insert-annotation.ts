import { Effect } from "effect";

import { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type { ExcerptSummary } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type {
  AnnotationRecord,
  AnnotationSource,
} from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import {
  annotationAttachmentFrom,
  excerptInputs,
  excerptRequestFrom,
} from "@zotlit/annotations/obsidian/excerpt-image/request.ts";
import { buildAnnotationParents } from "@zotlit/db";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { libraryFilePaths } from "@zotlit/plugin-services/obsidian/library-source/paths.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import {
  annotationCitation,
  buildAnnotationResolvers,
} from "#desktop/template/annotation-render.ts";
import { annotationInsertData } from "#obsidian/note-feature/insert-annotation-data.ts";
import { Profile } from "#obsidian/profile/service.ts";
import {
  ProfileAnnotationError,
  Template,
} from "#obsidian/template/service.ts";
import { syncTemplate } from "#obsidian/template/sync-template.ts";

export interface AnnotationInsertOptions {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  notePath: string;
  valid: () => boolean;
}

export interface AnnotationInsert {
  text: string;
  summary: ExcerptSummary;
}

export const prepareAnnotationInsert = Effect.fn(
  "NoteFeature.prepareAnnotationInsert",
)(function* (options: AnnotationInsertOptions) {
  const { annotation: a, source } = options;
  const pref = yield* ZoteroPref;
  const reads = yield* (yield* ZoteroReads).snapshot;
  const valid = Effect.map(
    pref.current,
    ({ dataDir }) => options.valid() && options.sourceScope === dataDir,
  );
  if (!(yield* valid)) return null;
  const paths = yield* libraryFilePaths;
  const inputs = yield* excerptInputs(reads, a.parentKey);
  const attachment = annotationAttachmentFrom({
    ...inputs,
    annotation: a,
    source,
  });
  const key = parseIndexedKey(a.key);
  if (!attachment || !key) return null;
  const request = excerptRequestFrom({
    ...inputs,
    annotation: a,
    source,
    paths,
  });
  const unusedImport = () => {
    throw new Error(
      "Captured annotation rendering uses prepared excerpt helpers",
    );
  };
  const resolvers = buildAnnotationResolvers({
    zoteroPref: paths,
    attachmentImport: { decide: unusedImport, resolveLink: unusedImport },
    annotationImageLink: () => null,
  });
  const { parentItem, tplAttachment } = buildAnnotationParents(
    inputs.sources,
    resolvers,
  ).get(attachment.itemID)!;
  const [file] = parentItem
    ? yield* (yield* NoteIndex).getNotesByItemKey(parentItem.indexedKey)
    : [];
  const profile = yield* (yield* Profile).profileOf(file);
  if (!profile.ok)
    return yield* Effect.fail(
      new ProfileAnnotationError(
        unknownProfileDiagnostic(profile.stamped.stamp, {
          path: file?.path,
          indexedKey: parentItem?.indexedKey,
        }),
      ),
    );
  const page = "pageIndex" in a.position ? a.position.pageIndex + 1 : null;
  const fileLink = resolvers.fileLink(attachment, { annotation: a.key, page });
  const backlink = annotationOpenUri({
    annotationKey: key.key,
    attachmentKey: attachment.key,
    groupID: key.groupID,
    pageLabel: a.pageLabel,
  });
  const settings = yield* (yield* PluginSettings).current;
  const prepared = yield* (yield* ExcerptPreparation).forCard({
    annotation: a,
    request,
    settings,
    notePath: options.notePath,
    sourceLink: `[Zotero](${backlink})`,
    valid,
  });
  if (!(yield* valid)) return null;
  const templates = yield* syncTemplate;
  const data = annotationInsertData({
    annotation: a,
    key: key.key,
    libraryID: attachment.libraryID,
    page,
    resolvers,
    imgLink: prepared.helper,
    fileLink,
    backlink,
    parent: { parentItem, tplAttachment },
    citation: () => annotationCitation(parentItem, a.pageLabel, templates),
  });
  const text = yield* (yield* Template).renderProfileAnnotation(data, {
    profile: profile.profile,
  });
  return { text, summary: prepared.summary() } satisfies AnnotationInsert;
}, Effect.scoped);
