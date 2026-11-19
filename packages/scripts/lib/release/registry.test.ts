import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { startLocalRegistry } from "./local-registry.ts";
import type { LocalRegistry } from "./local-registry.ts";
import { Registry } from "./registry.ts";
import { tarballDifferences } from "./tarball.ts";

// npm tarballs of a small package, packed by `tar` the way npm lays them out,
// served by the local registry over HTTP.
const run = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), "zt-registry-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

let registry: LocalRegistry;
beforeEach(async () => {
  registry = await startLocalRegistry();
});
afterEach(() => registry.close());

/** Packs `files` as `@zotlit/sample@<version>`; `level` is the gzip level. */
async function pack(
  version: string,
  files: Record<string, string> = {},
  level = 6,
): Promise<string> {
  const dir = join(scratch, `${version}-${Math.random()}`);
  await mkdir(join(dir, "package"), { recursive: true });
  await writeFile(
    join(dir, "package/package.json"),
    JSON.stringify({ name: "@zotlit/sample", version }),
  );
  for (const [name, text] of Object.entries({
    "main.js": "main\n",
    ...files,
  })) {
    await writeFile(join(dir, "package", name), text);
  }
  const tarball = `${dir}.tgz`;
  await run("sh", [
    "-c",
    `tar -cf - -C "${dir}" package | gzip -${level} > "${tarball}"`,
  ]);
  return tarball;
}

describe("the registry", () => {
  it("serves a published version and its tarball, and no other version", async () => {
    const tarball = await pack("1.0.0-beta.0");
    await registry.publish(tarball, "beta");
    const reader = new Registry(registry.url);

    expect(await reader.tarball("@zotlit/sample", "1.0.0-beta.0")).toEqual(
      await readFile(tarball),
    );
    expect(await reader.tarball("@zotlit/sample", "1.0.0")).toBeUndefined();
    expect(await reader.tarball("@zotlit/other", "1.0.0")).toBeUndefined();
  });

  it("takes a version once, as npm does", async () => {
    await registry.publish(await pack("1.0.0"), "latest");

    await expect(
      registry.publish(await pack("1.0.0"), "latest"),
    ).rejects.toThrow(/published once/);
  });

  it("stops waiting for a version the registry never serves", async () => {
    const reader = new Registry(registry.url);

    await expect(
      reader.waitFor("@zotlit/sample", "9.9.9", {
        timeoutMs: 50,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/did not serve/);
  });
});

describe("tarballDifferences", () => {
  it("finds two packs of the same files the same, whatever their gzip bytes", async () => {
    const fast = await readFile(await pack("1.0.0", {}, 1));
    const best = await readFile(await pack("1.0.0", {}, 9));
    expect(fast).not.toEqual(best);

    expect(await tarballDifferences(fast, best, join(scratch, "same"))).toEqual(
      [],
    );
  });

  it("names each file whose bytes differ or that one side lacks", async () => {
    const before = await readFile(await pack("1.0.0", { "styles.css": "a\n" }));
    const after = await readFile(
      await pack("1.0.0", { "main.js": "changed\n", "extra.js": "x\n" }),
    );

    expect(
      await tarballDifferences(before, after, join(scratch, "differ")),
    ).toEqual(["package/extra.js", "package/main.js", "package/styles.css"]);
  });
});
