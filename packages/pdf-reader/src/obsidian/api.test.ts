import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { ApiReport } from "./api.browser-test.ts";

import {
  binaryAssets,
  obsidianSetup,
  obsidianStandIn,
  readerAlias,
} from "#test/vite.ts";

const entry = resolve(import.meta.dirname, "api.browser-test.ts");

it.skipIf(!testElectron)(
  "gives the registration's ReaderApi: live extensions on mounted embeds, documents with a reason on failure, and close listeners before the layer goes, past one that throws",
  async () => {
    const provenance = JSON.parse(
      await readFile(
        resolve(
          await getWorkspaceRoot(import.meta.dirname),
          "packages/pdfjs/provenance.json",
        ),
        "utf8",
      ),
    ) as { readonly commit: string };
    const report = (await runInElectron({
      entry,
      name: "pdfReaderApiTrial",
      marker: "PDF_READER_API_RESULT",
      plugins: [binaryAssets, obsidianSetup(entry)],
      alias: { ...readerAlias, ...obsidianStandIn },
      timeoutMs: 90_000,
    })) as ApiReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    expect(report.identity).toEqual({
      api: { major: 1, minor: 1 },
      readerVersion: "9.9.9-trial",
      pdfjsBuild: provenance.commit,
      viewType: "trial-pdf",
      readerOfNull: true,
    });
    expect(report.attached).toEqual([
      { id: "option", subpath: "#page=2", restored: false, kind: "embed" },
      { id: "early", subpath: "#page=2", restored: false, kind: "embed" },
      { id: "late", subpath: null, restored: true, kind: "embed" },
      { id: "option", subpath: null, restored: false, kind: "embed" },
      { id: "early", subpath: null, restored: false, kind: "embed" },
      { id: "late", subpath: null, restored: false, kind: "embed" },
    ]);
    expect(report.lateNodes).toEqual({ before: 2, after: 0 });
    expect(report.lateDisposed).toBe(2);
    expect(report.loaded).toEqual({ pages: 8 });
    expect(report.rejected).toEqual({ reason: "invalid" });
    expect(report.unload).toEqual([
      "close:throws",
      "close",
      "dispose:early:true",
      "dispose:early:true",
      "dispose:option:true",
      "dispose:option:true",
    ]);
    expect(report.reports).toEqual(["close"]);
  },
  120_000,
);
