import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { cases } from "@zotlit/resource-pack/container.browser-test.ts";
import { runInElectron, testElectron } from "@zotlit/scripts/electron-renderer";

it.skipIf(!testElectron)(
  "the Pack container cases give the same outcomes in a browser, on its fetch, crypto.subtle and DecompressionStream",
  async () => {
    const outcomes = (await runInElectron({
      entry: fileURLToPath(
        import.meta.resolve("@zotlit/resource-pack/container.browser-test.ts"),
      ),
      name: "resourcePackContainer",
      marker: "RESOURCE_PACK_CONTAINER_RESULT",
    })) as Record<string, unknown>;

    expect(outcomes).toEqual(
      Object.fromEntries(cases.map(({ name, expected }) => [name, expected])),
    );
  },
  60_000,
);
