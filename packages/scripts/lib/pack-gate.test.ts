import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { writePack } from "@zotlit/resource-pack/writer.ts";

import { checkPack } from "./pack-gate.ts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const ALPHA = new TextEncoder().encode("\0asm alpha");
const BETA = new TextEncoder().encode("\0asm beta");

async function pack(...entries: [name: string, bytes: Uint8Array][]) {
  return new TextDecoder().decode(
    await writePack({
      entries: entries.map(([name, bytes]) => ({
        name,
        bytes: new Uint8Array(bytes),
        sha256: sha256(bytes),
      })),
    }),
  );
}

describe("checkPack", () => {
  it("passes a pack whose entries read back as their pins after Obsidian's install", async () => {
    expect(
      await checkPack(await pack(["alpha", ALPHA], ["beta", BETA]), {
        alpha: { sha256: sha256(ALPHA) },
        beta: { sha256: sha256(BETA) },
      }),
    ).toEqual({
      lines: [
        "alpha 10 B, read back as its pin",
        "beta 9 B, read back as its pin",
      ],
      failures: [],
    });
  });

  it("fails an entry whose bytes differ from its pin", async () => {
    const report = await checkPack(await pack(["alpha", BETA]), {
      alpha: { sha256: sha256(ALPHA) },
    });
    expect(report.failures).toEqual([
      `Pack Entry "alpha" reads back as ${sha256(BETA)}, and its pin is ${sha256(ALPHA)}`,
    ]);
  });

  it("fails a pinned entry that the pack does not hold", async () => {
    const report = await checkPack(await pack(["alpha", ALPHA]), {
      alpha: { sha256: sha256(ALPHA) },
      beta: { sha256: sha256(BETA) },
    });
    expect(report.failures).toEqual([
      'Pack Entry "beta" does not read back: entry-missing',
    ]);
  });

  it("fails an entry that has no pin", async () => {
    const report = await checkPack(
      await pack(["alpha", ALPHA], ["beta", BETA]),
      {
        alpha: { sha256: sha256(ALPHA) },
      },
    );
    expect(report.failures).toEqual(['Pack Entry "beta" has no pin']);
  });

  it("fails an entry that Obsidian's install would damage", async () => {
    const built = await pack(["alpha", ALPHA]);
    const report = await checkPack(
      built.replace(
        "/* Pack Entries",
        "//# sourceMappingURL=data:application/json;base64,e30=\n/* Pack Entries",
      ),
      { alpha: { sha256: sha256(ALPHA) } },
    );
    expect(report.failures).toEqual([
      'Pack Entry "alpha" does not read back: entry-damaged',
    ]);
  });

  it("fails a main.js that is not valid JavaScript", async () => {
    const built = await pack(["alpha", ALPHA]);
    const report = await checkPack(
      built.replace("module.exports =", "module.exports )"),
      {
        alpha: { sha256: sha256(ALPHA) },
      },
    );
    expect(report.failures).toEqual([
      "main.js is not valid JavaScript: Unexpected token ')'",
    ]);
  });

  it("fails a main.js that does not start with a pack index", async () => {
    const report = await checkPack("module.exports = class {};\n", {});
    expect(report.failures).toEqual([
      "main.js does not start with a pack index",
    ]);
  });
});
