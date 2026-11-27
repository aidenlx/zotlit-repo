import { Effect, Stream } from "effect";

import type { CiteRef } from "@zotlit/db";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import type { TemplateDataServices } from "./data.ts";
import { readTemplateData } from "./data.ts";

export interface MigrationVerificationData {
  readonly note: object;
  readonly filename: object;
  readonly annotation: object | null;
  readonly citation: readonly CiteRef[];
}

interface Verified {
  readonly base: MigrationVerificationData;
  readonly complete: MigrationVerificationData | null;
}

const load = (indexedKey: string, root: "note" | "filename" | "annotation") =>
  readTemplateData(indexedKey, root).pipe(
    Effect.mapError(({ cause }) => cause),
  );

export const readMigrationVerificationData = Effect.fn(
  "TemplateMigration.readVerificationData",
)(function* (options: {
  annotation: boolean;
}): Effect.fn.Return<
  MigrationVerificationData | null,
  unknown,
  TemplateDataServices | LibraryScope
> {
  const libraryScope = yield* LibraryScope;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const scope = yield* libraryScope.resolveLibraries(
        yield* reads.Libraries({}),
      );
      const candidates = Stream.fromIterable(scope.available, {
        chunkSize: 1,
      }).pipe(
        Stream.flatMap((library) =>
          Stream.unwrap(
            Effect.map(
              reads.ScopeItemIDs({
                kind: "literature-items",
                libraryID: library.libraryID,
              }),
              (itemIDs) => reads.DisplayRefs({ itemIDs: itemIDs ?? [] }),
            ),
          ),
        ),
        Stream.flatMap((slice) =>
          Stream.fromIterable(
            slice.flatMap(({ ref }) => (ref ? [ref.indexedKey] : [])),
            { chunkSize: 1 },
          ),
        ),
      );

      const verified = yield* candidates.pipe(
        Stream.mapEffect(
          Effect.fnUntraced(function* (indexedKey) {
            const citation = yield* citationVerificationRefs(reads, indexedKey);
            const [note, filename] = yield* Effect.all(
              [load(indexedKey, "note"), load(indexedKey, "filename")],
              { concurrency: "unbounded" },
            );
            if (note.kind !== "data" || filename.kind !== "data") return null;
            const base: MigrationVerificationData = {
              note: note.data,
              filename: filename.data,
              annotation: null,
              citation,
            };
            if (!options.annotation) return { base, complete: base };
            const annotationKey = firstAnnotationIndexedKey(note.data);
            if (!annotationKey) return { base, complete: null };
            const annotation = yield* load(annotationKey, "annotation");
            return {
              base,
              complete:
                annotation.kind === "data"
                  ? { ...base, annotation: annotation.data }
                  : null,
            };
          }),
        ),
        Stream.filter((candidate) => candidate !== null),
        Stream.takeUntil((candidate) => candidate.complete !== null),
        Stream.runFold(
          (): Verified | null => null,
          (first, candidate): Verified => ({
            base: (first ?? candidate).base,
            complete: candidate.complete,
          }),
        ),
      );
      return verified && (verified.complete ?? verified.base);
    }),
  );
});

const citationVerificationRefs = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
) {
  const items = yield* reads.ItemsByIndexedKeys({ indexedKeys: [indexedKey] });
  const item = items.get(indexedKey);
  if (!item) return [] as readonly CiteRef[];
  const citationKey =
    "citationKey" in item.fields ? (item.fields.citationKey ?? null) : null;
  return [{ citationKey, item }] as readonly CiteRef[];
});

function firstAnnotationIndexedKey(data: object): string | undefined {
  if (!("annotations" in data) || !Array.isArray(data.annotations)) {
    return undefined;
  }
  for (const annotation of data.annotations) {
    if (
      annotation !== null &&
      typeof annotation === "object" &&
      "indexedKey" in annotation &&
      typeof annotation.indexedKey === "string"
    ) {
      return annotation.indexedKey;
    }
  }
  return undefined;
}
