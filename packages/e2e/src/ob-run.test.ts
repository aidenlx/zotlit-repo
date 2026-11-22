import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { serializationProbe } from "./__fixtures__/serialized-callback.ts";

describe("page callback serialization", () => {
  it("runs transformed callbacks with only the supplied context", async () => {
    expect(await serializationProbe()).toEqual({ value: 42, disposed: true });
  });
  it("runs the same callback under plain Node type stripping", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "--eval",
      `import {serializationProbe} from ${JSON.stringify(new URL("./__fixtures__/serialized-callback.ts", import.meta.url).href)}; console.log(JSON.stringify(await serializationProbe()));`,
    ]);
    expect(JSON.parse(stdout)).toEqual({ value: 42, disposed: true });
  });
});
