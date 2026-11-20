import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { EXCERPT_RENDERING_CASES } from "@zotlit/scripts/fixture/spec";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { CropReport } from "./crop.browser-test.ts";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

async function trialData() {
  const pdf = resolve(
    await getWorkspaceRoot(import.meta.dirname),
    "packages/scripts/lib/fixture/assets/excerpt-rendering/excerpt-rendering.pdf",
  );
  return {
    pdf: (await readFile(pdf)).toString("base64"),
    cases: EXCERPT_RENDERING_CASES,
  };
}

it.skipIf(!testElectron)(
  "crops the Fixture excerpt cases through PdfEngine.load to the expected pixels",
  async () => {
    const data = JSON.stringify(await trialData());
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "crop.browser-test.ts"),
      name: "excerptCropTrial",
      marker: "EXCERPT_CROP_RESULT",
      plugins: [
        {
          name: "excerpt-crop-trial-data",
          config: () => ({ define: { __EXCERPT_CROP_TRIAL__: data } }),
        },
      ],
      alias: {
        "node:crypto": resolve(
          import.meta.dirname,
          "../../__fixtures__/excerpt-image/renderer-hash.ts",
        ),
      },
      timeoutMs: 120_000,
    })) as CropReport;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

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
    expect(report.workers).toEqual(["zotlit-pdfjs"]);
    expect(report.fetches).toEqual([]);
    expect(report.resident).toEqual({
      documentOpen: true,
      renderTaskActive: false,
      canvas: null,
    });
    expect(report.released).toEqual({
      documentOpen: false,
      jobActive: false,
      fileOpen: false,
    });
    const [first] = EXCERPT_RENDERING_CASES;
    expect(report.cancelled).toEqual({
      held: {
        phase: "document-loading",
        jobActive: true,
        fileOpen: true,
        documentOpen: true,
      },
      outcome: "AbortError",
      load: { name: "PdfLoadError", reason: "aborted" },
      after: {
        phase: "idle",
        jobActive: false,
        fileOpen: false,
        documentOpen: false,
      },
      retry: {
        id: first!.id,
        mimeType: "image/webp",
        width: first!.expected.width,
        height: first!.expected.height,
        samples: first!.expected.samples.map((sample) => sample.slice(2)),
      },
      loads: { borrowed: 0, detached: 1, fileOpens: 2, documentLoads: 2 },
    });
  },
  150_000,
);
