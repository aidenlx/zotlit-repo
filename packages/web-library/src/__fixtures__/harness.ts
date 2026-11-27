import { sql } from "drizzle-orm";
import { Effect, Redacted } from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import { createReplica } from "@zotlit/db/replica";
import { stagingViolations } from "@zotlit/db/replica/staging-invariants";
import type { StagingCheckOptions } from "@zotlit/db/replica/staging-invariants";
import { openNodeReplica } from "@zotlit/db/replica/parity-pair";
import type { ReplicaClient } from "@zotlit/db/replica/parity-pair";
import type { WebApiKey } from "@zotlit/zotero-types/web-api";

import { startFakeZoteroServer } from "./fake-zotero-server.ts";
import type { FakeZoteroServer } from "./fake-zotero-server.ts";
import { openScenarioApi } from "./scenario.ts";

import { applyDownload, downloadReplica, stageOn } from "#index.ts";
import type { SyncProgress, WebApiFetch } from "#index.ts";
import type { ScenarioApi } from "./scenario.ts";

export interface SyncHarness extends ScenarioApi {
  readonly server: FakeZoteroServer;
  readonly replica: ReplicaClient;
  readonly progress: SyncProgress[];
  readonly download: (
    key?: string,
    fetch?: WebApiFetch,
  ) => ReturnType<typeof downloadReplica>;
  readonly apply: (options?: {
    readonly pageSize?: number;
  }) => ReturnType<typeof applyDownload>;
}

export interface SyncHarnessOptions {
  readonly access?: WebApiKey["access"];
  readonly openReplica?: () => ReplicaClient;
}

export function expectStagingInvariants(
  db: ZoteroDatabase,
  options?: StagingCheckOptions,
): void {
  const violations = stagingViolations(db, options);
  if (violations.length > 0)
    throw new Error(
      `The staging breaks its rules: ${JSON.stringify(violations)}`,
    );
}

export function syncHarness({
  access,
  openReplica = openNodeReplica,
}: SyncHarnessOptions = {}) {
  return Effect.acquireRelease(
    Effect.promise(async (): Promise<SyncHarness> => {
      const scenario = openScenarioApi(access);
      const server = await startFakeZoteroServer(scenario.api);
      const replica = openReplica();
      createReplica(replica.db);
      const progress: SyncProgress[] = [];
      return {
        ...scenario,
        server,
        replica,
        progress,
        download: (
          key = scenario.key,
          fetch: WebApiFetch = (url, init) => globalThis.fetch(url, init),
        ) =>
          downloadReplica(stageOn(replica.db), {
            apiKey: Redacted.make(key),
            fetch,
            baseUrl: server.url,
            onProgress: (event) => {
              expectStagingInvariants(replica.db);
              progress.push(event);
            },
          }).pipe(
            Effect.tap((report) =>
              Effect.sync(() =>
                expectStagingInvariants(replica.db, {
                  listed: report.libraries
                    .filter((library) => library.outcome !== "removed")
                    .map(({ library }) => ({
                      ...library,
                      notesAccess:
                        library.type === "group" ||
                        !!scenario.api.keys.get(key)?.access.user?.notes,
                    })),
                  rebuild: false,
                }),
              ),
            ),
            Effect.ensuring(
              Effect.sync(() => expectStagingInvariants(replica.db)),
            ),
          ),
        apply: (options = {}) => {
          let applied = false;
          try {
            const result = applyDownload(replica.db, {
              now: Temporal.Now.instant(),
              ...options,
            });
            applied = true;
            return result;
          } finally {
            expectStagingInvariants(replica.db, { afterApply: applied });
          }
        },
      };
    }),
    (harness) =>
      Effect.promise(async () => {
        await harness.server.close();
        harness.replica.close();
        harness[Symbol.dispose]();
      }),
  );
}

export function syncAndApply(harness: SyncHarness) {
  return Effect.map(harness.download(), (report) => ({
    report,
    applied: harness.apply(),
  }));
}

export function libraryVersions(db: ZoteroDatabase): Record<string, number> {
  return Object.fromEntries(
    db
      .all<{ type: string; groupID: number | null; version: number }>(
        sql`select l.type, g.groupID, l.version from libraries l left join groups g using (libraryID)`,
      )
      .map((row) => [
        row.groupID === null ? "user" : `group:${row.groupID}`,
        Number(row.version),
      ]),
  );
}
