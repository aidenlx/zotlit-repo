import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { LicenceFallback } from "./worker-notices.ts";
import { bundledNotice } from "./worker-notices.ts";

async function workspace(
  packages: Record<
    string,
    { version: string; files?: Record<string, string>; dirs?: string[] }
  >,
  fallbacks: (LicenceFallback & { text: string })[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), "zt-notices-"));
  const moduleIds: string[] = [];
  for (const [dir, { version, files = {}, dirs = [] }] of Object.entries(
    packages,
  )) {
    const at = join(root, dir);
    await mkdir(at, { recursive: true });
    const name = dir.slice(dir.lastIndexOf("node_modules/") + 13);
    await writeFile(
      join(at, "package.json"),
      JSON.stringify({ name, version, license: "MIT" }),
    );
    for (const [file, text] of Object.entries(files))
      await writeFile(join(at, file), text);
    for (const sub of dirs) await mkdir(join(at, sub));
    await writeFile(join(at, "index.js"), "");
    moduleIds.push(join(at, "index.js"));
  }
  const manifest = join(root, "licences", "manifest.json");
  await mkdir(join(root, "licences"));
  for (const { file, text } of fallbacks)
    await writeFile(join(root, "licences", file), text);
  await writeFile(
    manifest,
    JSON.stringify(fallbacks.map(({ text: _text, ...entry }) => entry)),
  );
  return { moduleIds, manifest };
}

describe("bundledNotice", () => {
  it("lists two versions of one package and stops on the one with no licence", async () => {
    const { moduleIds, manifest } = await workspace({
      "node_modules/alpha": {
        version: "1.0.0",
        files: { LICENSE: "alpha one" },
      },
      "node_modules/beta/node_modules/alpha": { version: "2.0.0" },
    });
    const { notice, failures } = await bundledNotice(moduleIds, [], manifest);
    expect(notice).toContain("alpha 1.0.0 (MIT)\n\nalpha one");
    expect(failures).toEqual([
      expect.stringContaining(
        "bundles alpha 2.0.0, which ships no licence file",
      ),
    ]);
  });

  it("includes every licence file and the NOTICE file of a package", async () => {
    const { moduleIds, manifest } = await workspace({
      "node_modules/@scope/dual": {
        version: "3.0.0",
        files: {
          "LICENSE-APACHE": "apache text",
          "LICENSE-MIT": "mit text",
          NOTICE: "notice text",
          "README.md": "readme",
        },
      },
    });
    const { notice, failures } = await bundledNotice(moduleIds, [], manifest);
    expect(failures).toEqual([]);
    expect(notice).toContain("apache text\n\nmit text\n\nnotice text");
    expect(notice).not.toContain("readme");
  });

  it.each([
    ["only a notice file", { "NOTICE.md": "notice text" }],
    ["a script named like a licence", { "license-checker.js": "code" }],
  ])("stops on a package with %s", async (_what, files) => {
    const { moduleIds, manifest } = await workspace({
      "node_modules/gamma": { version: "1.0.0", files },
    });
    const { failures } = await bundledNotice(moduleIds, [], manifest);
    expect(failures).toEqual([
      expect.stringContaining(
        "bundles gamma 1.0.0, which ships no licence file",
      ),
    ]);
  });

  it("reads licence documents that are files and skips a directory named like one", async () => {
    const { moduleIds, manifest } = await workspace({
      "node_modules/delta": {
        version: "1.0.0",
        files: {
          "LICENSE.md": "licence text",
          "COPYING.txt": "copying text",
          "NOTICE.md": "notice text",
        },
        dirs: ["licenses"],
      },
    });
    const { notice, failures } = await bundledNotice(moduleIds, [], manifest);
    expect(failures).toEqual([]);
    expect(notice).toContain("copying text\n\nlicence text\n\nnotice text");
  });

  it("finds the fallback of each bundled version of a package", async () => {
    const { moduleIds, manifest } = await workspace(
      {
        "node_modules/epsilon": { version: "1.0.0" },
        "node_modules/zeta/node_modules/epsilon": { version: "2.0.0" },
      },
      ["1.0.0", "2.0.0"].map((version) => ({
        package: "epsilon",
        version,
        file: `epsilon-${version}-LICENSE`,
        source: "upstream tag",
        text: `epsilon licence ${version}`,
      })),
    );
    const { notice, failures } = await bundledNotice(moduleIds, [], manifest);
    expect(failures).toEqual([]);
    expect(notice).toContain("epsilon licence 1.0.0");
    expect(notice).toContain("epsilon licence 2.0.0");
  });

  it("prefers the package's own licence and binds a fallback to its version", async () => {
    const fallback = (pkg: string, version: string) => ({
      package: pkg,
      version,
      file: `${pkg}-LICENSE`,
      source: "upstream tag",
      text: `vendored ${pkg}`,
    });
    const { moduleIds, manifest } = await workspace(
      {
        "node_modules/own": {
          version: "1.0.0",
          files: { LICENCE: "own text" },
        },
        "node_modules/bare": { version: "1.0.0" },
        "node_modules/moved": { version: "2.0.0" },
      },
      [
        fallback("own", "1.0.0"),
        fallback("bare", "1.0.0"),
        fallback("moved", "1.0.0"),
      ],
    );
    const { notice, failures } = await bundledNotice(moduleIds, [], manifest);
    expect(notice).toContain("own text");
    expect(notice).not.toContain("vendored own");
    expect(notice).toContain("vendored bare");
    expect(failures).toEqual([
      expect.stringContaining(
        "bundles moved 2.0.0, and the licence manifest holds the licence verified for 1.0.0",
      ),
    ]);
  });

  it("carries the legal comments of the bundled code", async () => {
    const { moduleIds, manifest } = await workspace({});
    const { notice } = await bundledNotice(
      moduleIds,
      [
        {
          type: "Block",
          value: " @preserve\n** glue licence\n",
          start: 0,
          end: 1,
        },
        { type: "Block", value: "! kept */ inside", start: 2, end: 3 },
        { type: "Line", value: " a plain comment", start: 4, end: 5 },
      ],
      manifest,
    );
    expect(notice).toContain("The bundled code carries these notices:");
    expect(notice).toContain("@preserve\n** glue licence");
    expect(notice).toContain("! kept *\\/ inside");
    expect(notice).not.toContain("a plain comment");
  });
});
