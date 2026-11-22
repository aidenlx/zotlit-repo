import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import { Cause, Data, Effect } from "effect";
import type { Scope } from "effect";

import {
  annotationTypeToName,
  parseAnnotationPosition,
  resolveIndexedKeyLibraryIn,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  AnnotationSources,
  Attachment,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { ExcerptRequest } from "./contract.ts";

export type ExcerptRequestReads = Pick<
  ZoteroReadsApi,
  "AttachmentSources" | "DatabaseIdentity"
>;

export function savedExcerptRequestFor(input: {
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
}): Effect.Effect<ExcerptRequest | null, never, ZoteroReads | ZoteroPref> {
  const { annotation, source } = input;
  return Effect.gen(function* () {
    if (!source) return null;
    const reads = yield* ZoteroReads;
    const pref = yield* ZoteroPref;
    const { dataDir, baseAttachmentPath } = yield* pref.current;
    return yield* readSavedExcerptRequest({
      annotation,
      source,
      paths: { dataDir, baseAttachmentPath },
      snapshot: reads.snapshot,
      dataDir: Effect.map(pref.current, (current) => current.dataDir),
    });
  });
}

export function savedExcerptRequestOver(services: {
  readonly reads: ZoteroReads["Service"];
  readonly pref: ZoteroPref["Service"];
  readonly bridge: Pick<EffectBridge, "runPromiseExit">;
}): (input: {
  annotation: AnnotationRecord;
  source: AnnotationSource | null;
}) => Promise<ExcerptRequest | null> {
  return async (input) =>
    valueOr(
      await services.bridge.runPromiseExit(
        savedExcerptRequestFor(input).pipe(
          Effect.provideService(ZoteroReads, services.reads),
          Effect.provideService(ZoteroPref, services.pref),
        ),
      ),
      null,
    );
}

function readSavedExcerptRequest<E>(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  paths: AttachmentPathContext;
  snapshot: Effect.Effect<ExcerptRequestReads, E, Scope.Scope>;
  dataDir: Effect.Effect<string>;
}): Effect.Effect<ExcerptRequest | null> {
  const { annotation, source, paths } = options;
  return Effect.gen(function* () {
    const reads = yield* options.snapshot;
    const request = yield* excerptRequest({ annotation, source, reads, paths });
    return (yield* options.dataDir) === paths.dataDir ? request : null;
  }).pipe(
    Effect.scoped,
    recover(
      (cause) =>
        Effect.logDebug("No excerpt request: the database did not answer").pipe(
          Effect.annotateLogs({
            annotationKey: annotation.key,
            error: Cause.squash(cause),
          }),
        ),
      Effect.succeed(null),
    ),
    withLogCategory("excerpt-image"),
  );
}

export function excerptRequest(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  reads: ExcerptRequestReads;
  paths: AttachmentPathContext;
}) {
  return excerptInputs(options.reads, options.annotation.parentKey).pipe(
    Effect.map(({ identity, attachment }) =>
      excerptRequestFrom({ ...options, identity, attachment }),
    ),
  );
}

export function excerptInputs(reads: ExcerptRequestReads, parentKey: string) {
  return Effect.all(
    [
      reads.DatabaseIdentity({}),
      reads.AttachmentSources({ attachmentKeys: [parentKey] }),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(
      ([identity, sources]): {
        identity: ZoteroDatabaseIdentity;
        sources: AnnotationSources;
        attachment: Attachment | null;
      } => ({
        identity,
        sources,
        attachment:
          sources.attachments.find(
            ({ indexedKey }) => indexedKey === parentKey,
          ) ?? null,
      }),
    ),
  );
}

export function excerptRequestFrom(options: {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  identity: ZoteroDatabaseIdentity;
  attachment: Attachment | null;
  paths: AttachmentPathContext;
}): ExcerptRequest | null {
  const { annotation, source, identity, attachment, paths } = options;
  const compatible =
    source.kind === "zotero-local-api"
      ? identity.serverID === source.serverID
      : identity.serverID === source.database.serverID &&
        identity.userID === source.database.userID &&
        identity.localUserKey === source.database.localUserKey;
  if (!compatible) return null;
  const key = parseIndexedKey(annotation.key);
  if (!attachment || !key) return null;
  if (source.kind === "zotero-db" && source.libraryID !== attachment.libraryID)
    return null;
  return {
    annotation,
    source,
    sourceScope: paths.dataDir,
    attachmentKey: annotation.parentKey,
    libraryID: attachment.libraryID,
    pdfPath: attachmentAbsPath(attachment, paths),
    zoteroPngPath: resolveAnnotCachePath(
      { key: key.key, type: annotation.type },
      { dataDir: paths.dataDir, groupID: key.groupID },
    ),
  };
}

export type ExcerptKeyReads = Pick<
  ZoteroReadsApi,
  "AnnotationSources" | "DatabaseIdentity" | "Libraries"
>;

export class ExcerptSourceUnavailable extends Data.TaggedError(
  "ExcerptSourceUnavailable",
)<{ readonly message: string }> {}

export function excerptRequestForKey(options: {
  reads: ExcerptKeyReads;
  key: string;
  paths: AttachmentPathContext;
}): Effect.Effect<ExcerptRequest | null, ExcerptSourceUnavailable> {
  const { reads, key, paths } = options;
  return Effect.gen(function* () {
    const [libraries, identity] = yield* Effect.all(
      [reads.Libraries({}), reads.DatabaseIdentity({})],
      { concurrency: "unbounded" },
    );
    const target = resolveIndexedKeyLibraryIn(libraries, key);
    if (!target) return null;
    const sources = yield* reads.AnnotationSources({
      libraryID: target.libraryID,
      keys: [target.key],
    });
    const annotation = sources.annotations.find(
      (entry) => entry.indexedKey === key,
    );
    if (!annotation) return null;
    const attachment = sources.attachments.find(
      (entry) => entry.itemID === annotation.parentItemID,
    );
    if (!attachment) return null;
    return excerptRequestFrom({
      annotation: annotationRecordOf(annotation, attachment),
      source: {
        kind: "zotero-db",
        database: identity,
        libraryID: target.libraryID,
        libraryRevision:
          libraries.find((entry) => entry.libraryID === target.libraryID)
            ?.clientVersion ?? null,
      },
      identity,
      attachment,
      paths,
    });
  }).pipe(
    Effect.mapError(
      (error) =>
        new ExcerptSourceUnavailable({
          message:
            error instanceof Error && error.message
              ? error.message
              : String(error),
        }),
    ),
  );
}

export function annotationRecordOf(
  annotation: Annotation,
  attachment: Attachment,
  position: AnnotationPosition = parseAnnotationPosition(
    annotation.position,
    attachment.contentType ?? "",
  ),
): AnnotationRecord {
  return {
    key: annotation.indexedKey,
    parentKey: attachment.indexedKey,
    type: annotationTypeToName(annotation.type),
    text: annotation.text,
    comment: annotation.comment,
    color: annotation.color,
    pageLabel: annotation.pageLabel,
    sortIndex: annotation.sortIndex,
    tags: annotation.tags,
    position,
    version: annotation.version,
    lock: null,
  };
}
