import { mkdir, writeFile } from "node:fs/promises";
import type { Profiler } from "node:inspector";
import { join } from "node:path";

// oxlint-disable-next-line no-restricted-imports -- share the host benchmark's fixture without importing its Vitest suite.
import { syntheticNote } from "@zotlit/citations/__fixtures__/citation-index/scan-pipeline-note.ts";

import { obRun } from "./obsidian-cli.ts";
import type { PageDebugger, FileScan } from "./page-citation-types.ts";
import { e2eResultsDir } from "./results-dir.ts";

export async function measureCitationScan(vaultId: string) {
  const summaries = [];
  const directory = e2eResultsDir();
  await mkdir(directory, { recursive: true });
  for (const dense of [true, false]) {
    const density = dense ? "dense" : "sparse";
    const evidence = await obRun(
      vaultId,
      async ({ app, zotlit }, { text }) => {
        await using cleanup = new AsyncDisposableStack();
        const { bridge, citationIndex: index } = zotlit.services;
        if (
          (await bridge.runPromise(index.waitUntilSettled(15000))) !== "settled"
        )
          throw Error("Citation backfill did not settle");
        const client = (
          require("@electron/remote") as {
            getCurrentWebContents(): { debugger: PageDebugger };
          }
        ).getCurrentWebContents().debugger;
        const attached = client.isAttached();
        if (!attached) client.attach("1.3");
        if (!attached) cleanup.defer(() => client.detach());
        await client.sendCommand("Performance.enable", {
          timeDomain: "threadTicks",
        });
        cleanup.defer(async () => {
          await client.sendCommand("Performance.disable");
        });
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(`${app.appId}-zotlit-citation-index`);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error!);
        });
        cleanup.defer(() => db.close());

        const ready = Promise.withResolvers<void>();
        const changed = app.metadataCache.on("changed", (file) => {
          if (file.path === "Scan pipeline renderer budget.md") ready.resolve();
        });
        cleanup.defer(() => app.metadataCache.offref(changed));
        const timer = setTimeout(
          () => ready.reject(Error("Measurement note metadata did not settle")),
          15000,
        );
        cleanup.defer(() => clearTimeout(timer));
        const file = await app.vault.create(
          "Scan pipeline renderer budget.md",
          text,
        );
        cleanup.defer(() => app.vault.delete(file));
        await ready.promise;
        clearTimeout(timer);
        let previousScan = await bridge.runPromise(index.getFileScan(file));
        const cache = app.metadataCache.getFileCache(file);
        const taskCpu = async () => {
          const { metrics } = await client.sendCommand(
            "Performance.getMetrics",
          );
          const value = metrics.find(
            (metric) => metric.name === "TaskDuration",
          )?.value;
          if (!Number.isFinite(value))
            throw Error("Renderer TaskDuration unavailable");
          return value!;
        };
        const barrier = () =>
          new Promise<void>((resolve, reject) => {
            const transaction = db.transaction("scans", "readonly");
            transaction.objectStore("scans").count(file.path);
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(transaction.error!);
          });
        const samples = [];
        const floorSamples = [];
        const edit = async (n: number, unchanged = false) => {
          const key = `r${String(n + 1).padStart(4, "0")}`;
          const body = text.replace("[@work1]", `[@${key}]`);
          const start = await taskCpu();
          app.metadataCache.trigger("changed", file, body, cache);
          const scan = await bridge.runPromise(index.getFileScan(file));
          await barrier();
          const cpuMs = ((await taskCpu()) - start) * 1000;
          if (
            body.length !== 100000 ||
            scan?.citekeys[0]?.raw !== key ||
            scan.annotations.length === 0
          )
            throw Error("Edited 100k note did not reach the production index");
          if (unchanged && scan !== previousScan)
            throw Error("Unchanged text replaced the scan record");
          previousScan = scan;
          const persisted = await new Promise<FileScan | undefined>(
            (resolve, reject) => {
              const request = db
                .transaction("scans", "readonly")
                .objectStore("scans")
                .get(file.path);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error!);
            },
          );
          if (persisted?.citekeys[0]?.raw !== key)
            throw Error("Edited scan did not reach IndexedDB");
          return cpuMs;
        };
        await barrier();
        for (let n = 0; n < 18; n++) {
          const cpuMs = await edit(n);
          const floorMs = await edit(n, true);
          if (n >= 3) {
            samples.push(cpuMs);
            floorSamples.push(floorMs);
          }
        }
        await client.sendCommand("Profiler.enable");
        cleanup.defer(async () => {
          await client.sendCommand("Profiler.disable");
        });
        await client.sendCommand("Profiler.setSamplingInterval", {
          interval: 100,
        });
        await client.sendCommand("Profiler.start");
        let profile!: Profiler.Profile;
        try {
          for (let n = 18; n < 21; n++) await edit(n);
        } finally {
          ({ profile } = await client.sendCommand("Profiler.stop"));
        }
        return {
          samples,
          floorSamples,
          profile,
          characters: 100000,
          warmups: 3,
          profileEdits: 3,
        };
      },
      { text: syntheticNote(100_000, dense, true) },
      { timeoutMs: 120_000 },
    );
    const sorted = evidence.samples.toSorted((a, b) => a - b);
    const floorSorted = evidence.floorSamples.toSorted((a, b) => a - b);
    const nodes = new Map(
      evidence.profile.nodes.map((node) => [node.id, node]),
    );
    const frames = new Map<string, number>();
    for (const [at, id] of (evidence.profile.samples ?? []).entries()) {
      const frame = nodes.get(id)!.callFrame;
      if (frame.functionName === "(idle)") continue;
      const name = `${frame.functionName || "(anonymous)"} ${frame.url}:${frame.lineNumber + 1}`;
      frames.set(
        name,
        (frames.get(name) ?? 0) + evidence.profile.timeDeltas![at]! / 1000,
      );
    }
    const summary = {
      density,
      medianMs: sorted[Math.floor(sorted.length / 2)]!,
      p90Ms: sorted[Math.floor(sorted.length * 0.9)]!,
      maxMs: sorted.at(-1)!,
      samples: evidence.samples,
      harnessFloor: {
        medianMs: floorSorted[Math.floor(floorSorted.length / 2)]!,
        maxMs: floorSorted.at(-1)!,
        samples: evidence.floorSamples,
      },
      topFrames: [...frames.entries()]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([frame, sampledMs]) => ({ frame, sampledMs })),
    };
    summaries.push(summary);
    await writeFile(
      join(directory, `citation-scan-renderer-${density}.json`),
      JSON.stringify({ ...evidence, ...summary }, null, 2),
    );
    await writeFile(
      join(directory, `citation-scan-renderer-${density}.cpuprofile`),
      JSON.stringify(evidence.profile),
    );
  }
  await writeFile(
    join(directory, "citation-scan-renderer.json"),
    JSON.stringify(summaries, null, 2),
  );
  return summaries;
}
