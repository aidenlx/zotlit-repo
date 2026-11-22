import { resolve } from "node:path";
import { expect, it } from "vitest";

import {
  runInElectron,
  testElectron,
} from "#__fixtures__/excerpt-image/electron-renderer.ts";

it.skipIf(!testElectron)(
  "persists and bounds derived images in Chromium IndexedDB",
  async () => {
    const report = (await runInElectron({
      entry: resolve(import.meta.dirname, "store.browser-test.ts"),
      name: "excerptStoreTrial",
      marker: "EXCERPT_STORE_RESULT",
    })) as string[];

    expect(report).toHaveLength(9);
    expect(report.every((label) => label.length > 0)).toBe(true);
  },
  60_000,
);
