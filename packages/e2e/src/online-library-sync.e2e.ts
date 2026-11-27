import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RESOURCE_PACK_ID } from "@zotlit/plugin-services/core/managed-binary/resource-pack.ts";
import { pluginsOption } from "@zotlit/scripts/vault-plugins";
import { FakeZoteroApi } from "@zotlit/web-library/fake-zotero-api";
import {
  changeSeededItems,
  seedItemKey,
  seedLibrary,
} from "@zotlit/web-library/fake-zotero-api/seed";
import type { FakeZoteroServer } from "@zotlit/web-library/fake-zotero-api/server";
import { startFakeZoteroServer } from "@zotlit/web-library/fake-zotero-api/server";

import { prepareRunWindow } from "./background-throttling.ts";
import { reachable, runVaultScript, workspaceRoot } from "./e2e-run-fixture.ts";
import { openProfilesSettings } from "./e2e-run-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import {
  librarySourceRows,
  linkSecret,
  MAIN_ACCOUNT,
  messagePattern,
  pickRowOption,
  READ_ALL,
  REPLICA_ROOTS,
  restartWatchingWorkers,
  setOnlineLibraryRoot,
  setWebApiUrl,
  WEB_API_URL_KEY,
} from "./online-library.ts";
import { checkPerformanceBudgets } from "./performance-mode.ts";
import { registerRunVaultGuard } from "./run-vault-guard.ts";
import type {
  ReadSample,
  SyncMeasure,
  LastApply,
  SyncSample,
  SyncTrigger,
} from "./sync-measure.ts";
import { isSyncEnd, measureSync, statusAnswerOver } from "./sync-measure.ts";
import {
  clearVault,
  e2eVaultDir,
  installPlugins,
  installWithoutEnabling,
} from "./vault-script.ts";
import { reloadWindow } from "./window-reload.ts";

declare module "./page-helpers.ts" {
  interface PageScratch {
    syncProbe?: {
      readonly samples: SyncSample[];
      readonly reads: ReadSample[];
      readonly searches: SearchSample[];
      trigger: SyncTrigger | null;
      settled: boolean;
      failure: string | null;
      stop(): Promise<void>;
    };
  }
}

interface SearchSample {
  readonly start: number;
  readonly end: number;
  readonly hits: readonly SearchAnswer[];
}

interface SearchAnswer {
  readonly key: string;
  readonly title: string | null;
  readonly matches: string;
}

const m = await import("@zotlit/plugin-messages/messages.ts");

const SECRET = "zotero-sync-measure";
const SEEDED_ITEMS = 50_000;
const CHANGED_ITEMS = 5_000;
const DAILY_ITEMS = 100;
const TARGETS = {
  "node:sqlite root": {
    dailyReadWaitMs: 100,
    changedApplyMs: 500,
    firstBuildApplyMs: 3_000,
    statusAnswerMs: 50,
  },
  "wasm root on OPFS": {
    dailyReadWaitMs: 250,
    changedApplyMs: 1_500,
    firstBuildApplyMs: 10_000,
    statusAnswerMs: 50,
  },
} as const;

const count = (items: number) => items.toLocaleString("en-US");

describe.skipIf(!reachable).each(REPLICA_ROOTS)(
  "Zotero online library sync measurements on the $name",
  (root) => {
    const ROOT = root.name;
    const vaultPath = e2eVaultDir(
      workspaceRoot,
      root.slug === "wasm"
        ? "online-library-sync-vault"
        : `online-library-sync-${root.slug}-vault`,
    );
    let vaultId = "";
    let api: FakeZoteroApi;
    let server: FakeZoteroServer;
    const key = "0123456789abcdef01234567";
    registerRunVaultGuard(() => vaultId, { leftovers: false });

    const names = {
      group: m.settings_library_source_heading(),
      source: m.settings_library_source_name(),
      status: m.settings_online_status_name(),
    };
    const upToDate = messagePattern(m.settings_online_status_up_to_date, {
      time: "",
    });

    const searchItems = (query: string) =>
      obRun(
        vaultId,
        async ({ zotlit }, { query }) => {
          const services = zotlit.services;
          const hits = await services.bridge.runPromise(
            services.zoteroReads.reads.SearchItems({
              libraryIDs: [1],
              query,
              limit: 10,
            }),
          );
          return hits.map((hit): SearchAnswer => ({
            key: hit.item.key,
            title: (hit.item.fields as { title?: string }).title ?? null,
            matches: JSON.stringify(hit.matches),
          }));
        },
        { query },
        { timeoutMs: 120_000 },
      );

    const startProbe = (withReads: boolean, searchDuringApply: string | null) =>
      obRun(
        vaultId,
        async ({ page, zotlit }, { withReads, searchDuringApply }) => {
          const services = zotlit.services;
          await page.scratch.syncProbe?.stop();
          const now = () => performance.timeOrigin + performance.now();
          const samples: SyncSample[] = [];
          const reads: ReadSample[] = [];
          const pending = new Set<Promise<unknown>>();
          let stopped = false;
          const searches: SearchSample[] = [];
          let searching = false;
          const searchDuringSync = () => {
            if (searchDuringApply === null || searching) return;
            searching = true;
            const start = now();
            const done = services.bridge
              .runPromise(
                services.zoteroReads.reads.SearchItems({
                  libraryIDs: [1],
                  query: searchDuringApply,
                  limit: 10,
                }),
              )
              .then((hits) => {
                searches.push({
                  start,
                  end: now(),
                  hits: hits.map((hit) => ({
                    key: hit.item.key,
                    title:
                      (hit.item.fields as { title?: string }).title ?? null,
                    matches: JSON.stringify(hit.matches),
                  })),
                });
              })
              .finally(() => {
                searching = false;
                pending.delete(done);
              });
            pending.add(done);
          };
          const polling = (async () => {
            while (!stopped) {
              const start = now();
              try {
                const status = await services.bridge.runPromise(
                  services.librarySource.syncStatus,
                );
                samples.push({
                  start,
                  end: now(),
                  ok: true,
                  syncing: status.syncing,
                  lastApply: status.lastApply ?? null,
                });
                if (status.syncing) searchDuringSync();
              } catch {
                samples.push({
                  start,
                  end: now(),
                  ok: false,
                  syncing: null,
                  lastApply: null,
                });
              }
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          })();
          const read = () => {
            const start = now();
            const done = services.bridge
              .runPromise(services.zoteroReads.reads.Libraries({}))
              .then(
                () => reads.push({ start, end: now(), ok: true }),
                () => reads.push({ start, end: now(), ok: false }),
              )
              .finally(() => pending.delete(done));
            pending.add(done);
          };
          const cadence = withReads ? setInterval(read, 10) : undefined;
          page.scratch.syncProbe = {
            samples,
            reads,
            searches,
            trigger: null,
            settled: false,
            failure: null,
            stop: async () => {
              stopped = true;
              clearInterval(cadence);
              await polling;
              await Promise.all(pending);
            },
          };
        },
        { withReads, searchDuringApply },
      );

    const markTrigger = (by: "sync-now" | "outside") =>
      obRun(
        vaultId,
        async ({ page, zotlit }, { by }) => {
          const services = zotlit.services;
          const probe = page.scratch.syncProbe;
          if (!probe) throw new Error("Missing: the sync probe");
          if (by === "outside") {
            probe.trigger = { at: null, sequence: 0 };
            probe.settled = true;
            return;
          }
          const status = await services.bridge.runPromise(
            services.librarySource.syncStatus,
          );
          probe.trigger = {
            at: performance.timeOrigin + performance.now(),
            sequence: status.lastApply?.sequence ?? 0,
          };
          void services.bridge.runPromise(services.librarySource.syncNow).then(
            () => {
              probe.settled = true;
            },
            (error: unknown) => {
              probe.failure = Error.isError(error)
                ? error.message
                : String(error);
              probe.settled = true;
            },
          );
        },
        { by },
      );

    const stopProbe = () =>
      obRun(
        vaultId,
        async ({ page }) => {
          const probe = page.scratch.syncProbe;
          if (!probe) throw new Error("Missing: the sync probe");
          await probe.stop();
          delete page.scratch.syncProbe;
          return {
            samples: probe.samples,
            reads: probe.reads,
            trigger: probe.trigger,
            searches: probe.searches,
          };
        },
        undefined,
        { timeoutMs: 120_000 },
      );

    let searchesOfSync: readonly SearchSample[] = [];
    let applyOfSync: LastApply | null = null;
    const probedSync = async (
      what: string,
      {
        withReads,
        trigger,
        searchDuringApply = null,
      }: {
        withReads: boolean;
        trigger: () => Promise<void>;
        searchDuringApply?: string | null;
      },
    ): Promise<SyncMeasure> => {
      await startProbe(withReads, searchDuringApply);
      try {
        await trigger();
        const marker = await obRunUntil(
          vaultId,
          ({ page }) => {
            const probe = page.scratch.syncProbe;
            if (!probe) throw new Error("Missing: the sync probe");
            return {
              trigger: probe.trigger,
              settled: probe.settled,
              failure: probe.failure,
              last: probe.samples.findLast((sample) => sample.ok) ?? null,
            };
          },
          undefined,
          {
            ready: (value) =>
              value.failure !== null ||
              (value.settled &&
                value.trigger !== null &&
                value.last !== null &&
                isSyncEnd(value.last, value.trigger)),
            what: `the ${what} to end`,
            tries: 3_600,
          },
        );
        if (marker.failure !== null)
          throw new Error(`The ${what} failed: ${marker.failure}`);
      } catch (error) {
        await stopProbe().catch(() => undefined);
        throw error;
      }
      const probe = await stopProbe();
      searchesOfSync = probe.searches;
      applyOfSync =
        probe.samples.findLast(
          (sample) =>
            (sample.lastApply?.sequence ?? 0) > (probe.trigger?.sequence ?? 0),
        )?.lastApply ?? null;
      if (!probe.trigger) throw new Error("Missing: the trigger of the sync");
      return measureSync(probe.samples, probe.reads, probe.trigger);
    };

    const report = (label: string, measure: SyncMeasure) =>
      console.info(`Online library sync, ${ROOT}, ${label}`, measure);

    const upToDateShown = (what: string, tries: number) =>
      librarySourceRows(vaultId, names, {
        ready: (rows) => rows.status !== null && upToDate.test(rows.status),
        what,
        tries,
      });

    type FirstBuild =
      | { readonly measure: SyncMeasure }
      | { readonly error: unknown };
    let firstBuild: FirstBuild | null = null;
    const ensureBuilt = async (): Promise<FirstBuild> => {
      if (firstBuild) return firstBuild;
      const measured: FirstBuild = await probedSync("first build", {
        withReads: false,
        trigger: async () => {
          await markTrigger("outside");
          await linkSecret(vaultId, {
            row: m.settings_online_key_name(),
            name: SECRET,
            value: key,
          });
        },
      }).then(
        (measure) => ({ measure }),
        (error: unknown) => ({ error }),
      );
      await upToDateShown("the first build to end up to date", 2_400);
      firstBuild = measured;
      return measured;
    };

    const expectStatusAnswers = (measure: SyncMeasure) =>
      expect(
        statusAnswerOver(measure, TARGETS[ROOT].statusAnswerMs),
      ).toBeNull();

    const idleReads = (reads: number) =>
      obRunUntil(
        vaultId,
        ({ page }) => page.scratch.syncProbe?.reads.length ?? 0,
        undefined,
        {
          ready: (value) => value >= reads,
          what: `the probe to finish ${reads} reads before the sync`,
        },
      );

    beforeAll(async () => {
      api = new FakeZoteroApi(MAIN_ACCOUNT);
      seedLibrary(api.user, { items: SEEDED_ITEMS });
      api.addKey(key, READ_ALL);
      server = await startFakeZoteroServer(api);
      await clearVault(runVaultScript, vaultPath);
      const plugins = await installPlugins(
        workspaceRoot,
        vaultPath,
        pluginsOption.default,
      );
      const pack = await installWithoutEnabling(
        workspaceRoot,
        vaultPath,
        RESOURCE_PACK_ID,
      );
      const created = await runVaultScript(["open", vaultPath, plugins, pack]);
      vaultId = created.stdout.trim().split("\n")[0]!.trim();
      await prepareRunWindow(vaultId);
      await setOnlineLibraryRoot(vaultId, root);
      await setWebApiUrl(vaultId, server.url);
      await openProfilesSettings(vaultId, "settings_page_zotero");
      await pickRowOption(vaultId, { name: names.source, value: "web-api" });
      await librarySourceRows(vaultId, names, {
        ready: (rows) =>
          rows.rows.includes(m.settings_library_source_reload_name()),
        what: "the reload prompt for the online library",
      });
      await reloadWindow(vaultId, (id) =>
        obRun(
          id,
          ({ app }, { row }) => {
            const button = [
              ...app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item",
              ),
            ]
              .find(
                (el) =>
                  el.querySelector(".setting-item-name")?.textContent === row,
              )
              ?.querySelector<HTMLButtonElement>("button");
            if (!button) return false;
            setTimeout(() => button.click());
            return true;
          },
          { row: m.settings_library_source_reload_name() },
        ),
      );
      await prepareRunWindow(vaultId);
      await openProfilesSettings(vaultId, "settings_page_zotero");
    }, 600_000);

    afterAll(async () => {
      if (vaultId) {
        await obRun(
          vaultId,
          async ({ app, page }, { urlKey }) => {
            await page.scratch.syncProbe?.stop();
            app.setting.close();
            for (const key of Object.keys(localStorage))
              if (
                key.startsWith(`${app.appId}-zotlit-`) &&
                /library-source|online-library|zotero-web-api/.test(key)
              )
                localStorage.removeItem(key);
            app.saveLocalStorage(urlKey, null);
            for (const name of app.secretStorage.listSecrets())
              (
                app.secretStorage as typeof app.secretStorage & {
                  deleteSecret(id: string): void;
                }
              ).deleteSecret(name);
            await app.plugins.disablePlugin("zotlit");
            const remote =
              require("@electron/remote") as typeof import("@electron/remote");
            const { rmSync } = require("node:fs") as typeof import("node:fs");
            const { join } = require("node:path") as typeof import("node:path");
            rmSync(join(remote.app.getPath("userData"), "zotlit", app.appId), {
              recursive: true,
              force: true,
            });
            try {
              await (
                await (
                  await navigator.storage.getDirectory()
                ).getDirectoryHandle("zotlit")
              ).removeEntry(app.appId, { recursive: true });
            } catch {
              return;
            }
          },
          { urlKey: WEB_API_URL_KEY },
        ).catch(() => undefined);
      }
      await server?.close();
      await runVaultScript(["remove", vaultPath, "--purge"]);
    }, 120_000);

    it(`measures the first build of ${count(SEEDED_ITEMS)} items on the ${ROOT}`, async () => {
      const built = await ensureBuilt();
      if ("error" in built) throw built.error;
      const { measure } = built;
      report(`first build of ${count(SEEDED_ITEMS)} items`, measure);
      checkPerformanceBudgets(() => {
        expect(measure.applyMs).toBeLessThanOrEqual(
          TARGETS[ROOT].firstBuildApplyMs,
        );
        expectStatusAnswers(measure);
      });
    }, 1_800_000);

    it(`measures a sync of ${count(CHANGED_ITEMS)} changed items on the ${ROOT}`, async () => {
      await ensureBuilt();
      changeSeededItems(api.user, { items: CHANGED_ITEMS, round: 1 });
      const measure = await probedSync("sync of changed items", {
        withReads: false,
        trigger: () => markTrigger("sync-now"),
      });
      report(
        `sync of ${count(CHANGED_ITEMS)} changed items in ${count(SEEDED_ITEMS)}`,
        measure,
      );
      checkPerformanceBudgets(() => {
        expect(measure.applyMs).toBeLessThanOrEqual(
          TARGETS[ROOT].changedApplyMs,
        );
        expectStatusAnswers(measure);
      });
    }, 1_800_000);

    it(`measures the longest wait of a read in a daily sync of ${DAILY_ITEMS} changed items on the ${ROOT}`, async () => {
      await ensureBuilt();
      changeSeededItems(api.user, { items: DAILY_ITEMS, round: 2 });
      const query = "Seeded study 1 of reading habits, revision 2";
      const measure = await probedSync("daily sync", {
        withReads: true,
        searchDuringApply: query,
        trigger: async () => {
          await idleReads(10);
          await markTrigger("sync-now");
        },
      });
      report(
        `daily sync of ${DAILY_ITEMS} changed items in ${count(SEEDED_ITEMS)}`,
        measure,
      );
      expect(measure.readsFailed).toBe(0);
      expect(measure.readsInApply).toBeGreaterThan(0);
      const apply = applyOfSync;
      if (!apply) throw new Error("Missing: the apply of the daily sync");
      const during = searchesOfSync.find(
        (search) =>
          search.start >= apply.beganAt && search.start < apply.committedAt,
      );
      if (!during)
        throw new Error(
          "Missing: a search sent between the begin and the commit of the apply",
        );
      expect(during.end).toBeGreaterThanOrEqual(apply.committedAt);
      expect(during.hits).toContainEqual(
        expect.objectContaining({ key: seedItemKey(0), title: query }),
      );
      expect(during.hits).toEqual(await searchItems(query));
      checkPerformanceBudgets(() => {
        expect(measure.readWaitMs).toBeLessThanOrEqual(
          TARGETS[ROOT].dailyReadWaitMs,
        );
        expectStatusAnswers(measure);
      });
    }, 1_800_000);

    it(`keeps the last library complete when its Worker is terminated during an apply on the ${ROOT}, and the restarted Worker opens the file and finishes the sync`, async () => {
      await ensureBuilt();
      const changed = Array.from({ length: CHANGED_ITEMS }, (_, index) =>
        seedItemKey(index),
      );
      const fixtureDate = (revision: string) =>
        revision === "none"
          ? "2026-01-05T10:00:00Z"
          : `2026-02-01T00:00:0${revision}Z`;
      const revisions = () =>
        obRun(
          vaultId,
          async ({ zotlit }, { keys }) => {
            const services = zotlit.services;
            const items = await services.bridge.runPromise(
              services.zoteroReads.reads.ItemsByIndexedKeys({
                indexedKeys: keys,
              }),
            );
            const counts: Record<string, number> = {};
            for (const item of items.values()) {
              const { title } = item.fields as { title?: string };
              const revision =
                /revision (\d+)$/.exec(title ?? "")?.[1] ?? "none";
              const state = `${revision} ${item.dateModified.toString()}`;
              counts[state] = (counts[state] ?? 0) + 1;
            }
            return counts;
          },
          { keys: changed },
          { timeoutMs: 120_000 },
        );
      const syncState = async (
        what: string,
        ready: (state: { syncing: boolean }) => boolean,
        { tries, until = Infinity }: { tries: number; until?: number },
      ) => {
        let last: unknown = null;
        for (let attempt = 0; attempt < tries; attempt++) {
          const state = await obRun(vaultId, async ({ zotlit }) => {
            const services = zotlit.services;
            const status = await services.bridge.runPromise(
              services.librarySource.syncStatus,
            );
            return {
              syncing: status.syncing,
              problem: status.problem,
              lastApply: status.lastApply ?? null,
            };
          });
          if (ready(state)) return state;
          last = state;
          if (Temporal.Now.instant().epochMilliseconds >= until)
            throw new Error(
              `The deadline passed before ${what}: ${JSON.stringify(last)}`,
            );
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(`${what}: ${JSON.stringify(last)}`);
      };
      const fromFixture = (counts: Record<string, number>) =>
        Object.keys(counts).filter((state) => {
          const [revision = "none", date] = state.split(" ");
          return date !== fixtureDate(revision);
        });

      {
        await using workers = await restartWatchingWorkers(vaultId);
        await openProfilesSettings(vaultId, "settings_page_zotero");
        await upToDateShown("the restarted online library to be ready", 600);
        const before = await revisions();
        expect(fromFixture(before)).toEqual([]);
        expect(
          Object.keys(before).some((state) => state.startsWith("3 ")),
        ).toBe(false);
        changeSeededItems(api.user, { items: CHANGED_ITEMS, round: 3 });
        const stoppedIn = await workers.terminateDuringApply(root.worker);
        expect(stoppedIn).toMatchObject({
          progress: { phase: "apply" },
          terminated: 1,
        });
        await using held = new AsyncDisposableStack();
        held.defer(api.hold(() => true));
        await workers.restartUnwatched();
        const restartedAt = Temporal.Now.instant().epochMilliseconds;
        expect(await revisions()).toEqual(before);
        expect(
          await syncState(
            "the start-up sync of the restarted Worker to begin",
            (state) => state.syncing,
            { tries: Number.MAX_SAFE_INTEGER, until: restartedAt + 60_000 },
          ),
        ).toMatchObject({
          syncing: true,
          lastApply: null,
        });
      }
      expect(
        await syncState(
          "the start-up sync of the restarted Worker to end",
          (state) => !state.syncing,
          { tries: 480 },
        ),
      ).toMatchObject({
        problem: null,
        lastApply: { sequence: expect.any(Number) },
      });
      expect(await revisions()).toEqual({
        [`3 ${fixtureDate("3")}`]: CHANGED_ITEMS,
      });
    }, 1_800_000);
  },
);
