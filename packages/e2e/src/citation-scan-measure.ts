import { mkdir, writeFile } from "node:fs/promises";
import type { Profiler } from "node:inspector";
import { join } from "node:path";

// oxlint-disable-next-line no-restricted-imports -- share the host benchmark's fixture without importing its Vitest suite.
import { syntheticNote } from "@zotlit/citations/__fixtures__/citation-index/scan-pipeline-note.ts";
import type { ScanTimings } from "@zotlit/citations/core/citation-parse/scan-timings.ts";

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
        let deliver: ((timings: ScanTimings) => void) | undefined;
        if (!index.observeScanTimings)
          throw Error("The development Citation Index must expose scan timing");
        using _observation = index.observeScanTimings(
          file.path,
          () => performance.now(),
          (sample) => deliver?.(sample),
        );
        const edit = async (n: number, unchanged = false) => {
          const key = `r${String(n + 1).padStart(4, "0")}`;
          const body = text.replace("[@work1]", `[@${key}]`);
          const measured = Promise.withResolvers<ScanTimings>();
          deliver = measured.resolve;
          app.metadataCache.trigger("changed", file, body, cache);
          const deadline = setTimeout(
            () =>
              measured.reject(
                Error(`Renderer timings did not arrive for ${key}`),
              ),
            15000,
          );
          let timings: ScanTimings;
          try {
            timings = await measured.promise;
          } finally {
            clearTimeout(deadline);
            deliver = undefined;
          }
          const scan = await bridge.runPromise(index.getFileScan(file));
          if (timings.applyMs < timings.persistMs)
            throw Error(
              `Invalid renderer timings for ${key}: ${JSON.stringify(timings)}`,
            );
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
          return timings;
        };
        const warmups = 3;
        const measuredEdits = 15;
        const profileEdits = 15;
        const samples: ScanTimings[] = [];
        for (let n = 0; n < warmups + measuredEdits; n++) {
          const timings = await edit(n);
          if (n >= warmups) samples.push(timings);
        }
        const sameText = await edit(warmups + measuredEdits - 1, true);
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
          const first = warmups + measuredEdits;
          for (let n = first; n < first + profileEdits; n++) await edit(n);
        } finally {
          ({ profile } = await client.sendCommand("Profiler.stop"));
        }
        return {
          samples,
          sameText,
          profile,
          characters: 100000,
          warmups,
          profileEdits,
        };
      },
      { text: syntheticNote(100_000, dense, true) },
      { timeoutMs: 120_000 },
    );
    const samples = evidence.samples.map((timings) => {
      const post = timings.intakeMs + timings.requestMs;
      const apply = timings.applyMs - timings.persistMs;
      return {
        ...timings,
        rendererPostMs: post,
        rendererApplyMs: apply,
        rendererMs: post + apply,
      };
    });
    const summarize = (phase: keyof (typeof samples)[number]) => {
      const sorted = samples
        .map((sample) => sample[phase])
        .sort((a, b) => a - b);
      return {
        medianMs: sorted[Math.floor(sorted.length / 2)]!,
        p90Ms: sorted[Math.ceil(sorted.length * 0.9) - 1]!,
        maxMs: sorted.at(-1)!,
      };
    };
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
      ...summarize("rendererMs"),
      phases: {
        post: summarize("rendererPostMs"),
        apply: summarize("rendererApplyMs"),
        intake: summarize("intakeMs"),
        requestEncoding: summarize("encodeMs"),
        workerPost: summarize("postMs"),
        workerReceive: summarize("receiveMs"),
        replyDecoding: summarize("decodeMs"),
        scanComparison: summarize("compareMs"),
        reverseMapUpdates: summarize("updateMs"),
        persistence: summarize("persistMs"),
      },
      topFrames: [...frames.entries()]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([frame, sampledMs]) => ({ frame, sampledMs })),
    };
    summaries.push(summary);
    await writeFile(
      join(directory, `citation-scan-renderer-${density}.json`),
      JSON.stringify({ ...evidence, ...summary, samples }, null, 2),
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
