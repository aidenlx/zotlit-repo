import {
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Request,
  RequestResolver,
} from "effect";

import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { DatabaseAnswer } from "./model.ts";
import type { CoreState } from "./state.ts";

type DatabaseRowsError =
  | Effect.Error<ZoteroReads["Service"]["snapshot"]>
  | Effect.Error<
      ReturnType<ZoteroReads["Service"]["reads"]["AnnotationsOfAttachments"]>
    >;

class DatabaseRows extends Request.Class<
  { readonly attachmentKey: string; readonly generation: number },
  DatabaseAnswer,
  DatabaseRowsError
> {}

function databaseRowsResolver(
  db: Pick<ZoteroReads["Service"], "snapshot">,
  fibers: FiberSet.FiberSet,
): RequestResolver.RequestResolver<DatabaseRows> {
  return RequestResolver.makeGrouped<DatabaseRows, number>({
    key: ({ request }) => request.generation,
    resolver: (entries) =>
      Effect.gen(function* () {
        const attachmentKeys = [
          ...new Set(entries.map(({ request }) => request.attachmentKey)),
        ];
        const reads = yield* db.snapshot;
        const [found, libraries, database] = yield* Effect.all(
          [
            reads.AnnotationsOfAttachments({ attachmentKeys }),
            reads.Libraries({}),
            reads.DatabaseIdentity({}),
          ],
          { concurrency: "unbounded" },
        );
        yield* Effect.logDebug(
          "Annotations batch read from the Zotero database",
        ).pipe(Effect.annotateLogs({ attachments: attachmentKeys.length }));
        const byKey = new Map(found.map((rows) => [rows.attachmentKey, rows]));
        for (const entry of entries) {
          const rows = byKey.get(entry.request.attachmentKey);
          if (rows)
            entry.completeUnsafe(
              Exit.succeed({ found: rows, libraries, database }),
            );
        }
      }).pipe(
        Effect.scoped,
        (batch) => FiberSet.run(fibers, batch),
        Effect.flatMap((fiber) => Fiber.join(fiber)),
      ),
  });
}

function databaseRows(
  core: Pick<CoreState, "databaseGeneration" | "databaseRows">,
  attachmentKey: string,
): Effect.Effect<DatabaseAnswer, DatabaseRowsError> {
  return Effect.request(
    new DatabaseRows({ attachmentKey, generation: core.databaseGeneration }),
    core.databaseRows,
  );
}

export { databaseRowsResolver, databaseRows };
export type { DatabaseRowsError };
