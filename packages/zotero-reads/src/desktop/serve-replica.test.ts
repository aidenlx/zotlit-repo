import type { WebRootOptions } from "#worker/serve-web-api.ts";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect } from "vitest";

import { serveZoteroReadsReplica } from "./serve-replica.ts";

import { SEED } from "#__fixtures__/reads-seed.ts";
import { seededApi, webApiConfig } from "#__fixtures__/web-api.ts";
import { workerChannel } from "#__fixtures__/worker-channel.ts";
import { startReplicaWorker } from "#client/web-worker.ts";

const root = mkdtempSync(join(tmpdir(), "zotlit-replica-root-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const startReads = (api: ReturnType<typeof seededApi>, replicaPath: string) =>
  Effect.gen(function* () {
    const channel = yield* workerChannel;
    serveZoteroReadsReplica(channel.scope, {
      fetch: api.fetch,
      queryJobs: undefined as unknown as WebRootOptions["queryJobs"],
    });
    return yield* startReplicaWorker("/* worker */", {
      config: webApiConfig(api.key),
      replicaPath,
      spawn: channel.spawn,
    });
  });

describe("the desktop Worker root of the online library", () => {
  it.live(
    "keeps the replica in a SQLite file at the path of its initial message and reads the libraries of the account from it",
    () =>
      Effect.gen(function* () {
        const api = seededApi(SEED, { userID: 42, username: "reader" });
        const replicaPath = join(
          root,
          "zotlit",
          "vault-id",
          "zotero-replica.sqlite",
        );
        const reads = yield* startReads(api, replicaPath);
        yield* reads.Refresh().pipe(Effect.timeout("10 seconds"));
        const libraries = yield* reads
          .Libraries({})
          .pipe(Effect.timeout("10 seconds"));
        expect(
          libraries.map(({ type, groupID, name }) => ({ type, groupID, name })),
        ).toEqual([
          { type: "user", groupID: null, name: null },
          { type: "group", groupID: 900, name: "Lab" },
        ]);
        expect(existsSync(replicaPath)).toBe(true);
      }).pipe(Effect.scoped),
    30_000,
  );
});
