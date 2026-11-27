import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, onTestFailed } from "vitest";

import { EXCERPT_RENDERING_CASES } from "@zotlit/scripts/fixture/spec";
import {
  OBSIDIAN_RUNTIME_VERSION,
  missingObsidianRuntime,
} from "@zotlit/scripts/obsidian-runtime";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { ObsidianPdfJsReport } from "./obsidian-pdfjs.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const obsidianPdfJs = resolve(
  root,
  `node_modules/.ob-rev-${OBSIDIAN_RUNTIME_VERSION}/lib/pdfjs`,
);

it.skipIf(!testElectron)(
  "crops the Fixture excerpt cases through Obsidian 1.15.1's PDF.js to the expected pixels",
  async () => {
    if (!existsSync(obsidianPdfJs))
      throw new Error(missingObsidianRuntime(obsidianPdfJs));
    const pdf = resolve(
      root,
      "packages/scripts/lib/fixture/assets/excerpt-rendering/excerpt-rendering.pdf",
    );
    const data = JSON.stringify({
      pdf: (await readFile(pdf)).toString("base64"),
      cases: EXCERPT_RENDERING_CASES,
      lib: pathToFileURL(resolve(obsidianPdfJs, "pdf.min.mjs")).href,
      worker: pathToFileURL(resolve(obsidianPdfJs, "pdf.worker.min.mjs")).href,
    });
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "obsidian-pdfjs.browser-test.ts"),
      name: "excerptObsidianPdfJsTrial",
      marker: "EXCERPT_OBSIDIAN_PDFJS_RESULT",
      plugins: [
        {
          name: "excerpt-obsidian-pdfjs-trial-data",
          config: () => ({ define: { __OBSIDIAN_PDFJS_TRIAL__: data } }),
        },
      ],
      alias: {
        "node:crypto": resolve(
          import.meta.dirname,
          "../../__fixtures__/excerpt-image/renderer-hash.ts",
        ),
      },
      timeoutMs: 120_000,
    })) as ObsidianPdfJsReport;
    onTestFailed(() => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

    expect(report.version).toBe("5.3.34");
    expect(report.engine).toBe("obsidian-pdfjs");
    expect(report.cases).toEqual(
      EXCERPT_RENDERING_CASES.map(({ id, expected }) => ({
        id,
        mimeType: "image/webp",
        width: expected.width,
        height: expected.height,
        samples: expected.samples.map((sample) => sample.slice(2)),
      })),
    );
    expect(report.loads).toEqual({
      borrowed: 0,
      detached: EXCERPT_RENDERING_CASES.length,
      fileOpens: EXCERPT_RENDERING_CASES.length,
      documentLoads: 1,
    });
    expect(report.released).toBe(true);
    expect(report.cancelled).toEqual({
      outcome: "AbortError",
      retry: "image/webp",
    });
  },
  150_000,
);
