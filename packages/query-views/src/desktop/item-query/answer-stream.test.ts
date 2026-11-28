import type { ExportFiles } from "#core/item-query/export-files.ts";
import type { QueryJob } from "#worker/item-query/worker-protocol.ts";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { describe, expect } from "vitest";

import {
  fileConfig,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { workerChannelClient } from "@zotlit/zotero-reads/__fixtures__/worker-channel.ts";
import { MY_LIBRARY_SCOPE } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { snapshotRevision } from "@zotlit/zotero-reads/desktop/snapshot-revision.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";

import { deliverAnswer } from "./delivery.ts";
import { queryJobRunner } from "./job.ts";

import { QUERY_SCHEMA_COMMAND } from "#worker/item-query/contract.ts";
import { answerStream } from "#worker/item-query/job.ts";

const CHUNK = 256 * 1024;

const readerTurn = Effect.promise(
  () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve);
    }),
);

const IDENTITY = {
  vault: { name: "Research", path: "/vaults/research" },
  source: {
    kind: "file" as const,
    id: "source-1",
    databasePath: "/zotero/zotero.sqlite",
  },
};

const job: QueryJob = {
  schema: true,
  command: QUERY_SCHEMA_COMMAND,
  pluginVersion: "2.2.0",
  id: "slow-reader",
  vault: IDENTITY.vault,
  scope: MY_LIBRARY_SCOPE,
  attachmentPaths: { dataDir: "/zotero", baseAttachmentPath: null },
};

describe("the answer stream over the Worker channel", () => {
  it.live(
    "keeps the Worker at most one chunk ahead of a slow reader",
    () =>
      Effect.gen(function* () {
        const CHUNKS = 40;
        let produced = 0;
        let consumed = 0;
        let ahead = 0;
        const reads = yield* workerChannelClient(
          {
            connection: () => layerRcRef(memoryOpener(() => "").open),
            fileSystem: NodeFileSystem.layer,
            handlers: {
              snapshotRevision,
              queryJobs: {
                ...queryJobRunner,
                answer: () =>
                  answerStream((sink) =>
                    Effect.gen(function* () {
                      yield* sink.head({ ok: true, identity: IDENTITY });
                      for (let index = 0; index < CHUNKS; index++) {
                        yield* sink.emit(String(index % 10).repeat(CHUNK));
                        produced++;
                        ahead = Math.max(ahead, produced - consumed);
                      }
                    }),
                  ),
              },
            },
          },
          fileConfig("/zotero/zotero.sqlite", "source-1"),
        );
        const seen: number[] = [];
        const reader: ExportFiles = {
          write: (_path, document) =>
            Stream.runForEach(document, (bytes) =>
              Effect.gen(function* () {
                consumed++;
                seen.push(bytes.byteLength, bytes[0]!);
                yield* readerTurn;
              }),
            ).pipe(Effect.map(() => consumed * CHUNK)),
        };
        const receipt = yield* deliverAnswer({
          command: QUERY_SCHEMA_COMMAND,
          target: { kind: "file", path: "/exports/slow.json", format: "json" },
          answer: reads.QueryAnswer({ job }, { streamBufferSize: 0 }),
          files: reader,
        });
        expect(JSON.parse(receipt)).toMatchObject({
          ok: true,
          identity: IDENTITY,
          file: { bytes: CHUNKS * CHUNK },
        });
        expect(consumed).toBe(CHUNKS);
        expect(seen).toEqual(
          Array.from({ length: CHUNKS }, (_, index) => [
            CHUNK,
            "0".charCodeAt(0) + (index % 10),
          ]).flat(),
        );
        expect(ahead).toBeLessThanOrEqual(1);
      }).pipe(Effect.scoped),
    30_000,
  );
});
