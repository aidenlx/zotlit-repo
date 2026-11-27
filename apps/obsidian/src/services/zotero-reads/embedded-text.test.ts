import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { inflateEmbedded } from "./embedded-text.ts";

const TEXT = `(() => {self.onmessage = () => "é ✓ ${"worker ".repeat(2000)}";\n})();\n`;
const DEFLATED = deflateRawSync(TEXT, { level: 9 }).toString("base64");

const fromBase64 = Reflect.get(Uint8Array, "fromBase64") as unknown;
afterEach(() => Reflect.set(Uint8Array, "fromBase64", fromBase64));

describe("inflateEmbedded", () => {
  it("gives the bytes of the text that the build deflated", async () => {
    const blob = await inflateEmbedded(DEFLATED);
    expect(await blob.text()).toBe(TEXT);
  });

  it("decodes the base64 with atob where Uint8Array.fromBase64 is missing", async () => {
    Reflect.deleteProperty(Uint8Array, "fromBase64");
    const blob = await inflateEmbedded(DEFLATED);
    expect(await blob.text()).toBe(TEXT);
  });
});
