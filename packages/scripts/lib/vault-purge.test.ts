import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { purgeVault } from "./vault-purge.ts";

async function scratchFolder() {
  const path = await mkdtemp(join(tmpdir(), "zt-vault-purge-"));
  return {
    path,
    [Symbol.asyncDispose]: () => rm(path, { recursive: true, force: true }),
  };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("purgeVault", () => {
  it("succeeds when the vault folder does not exist", async () => {
    await using scratch = await scratchFolder();

    await expect(
      purgeVault(join(scratch.path, "never-created")),
    ).resolves.toBeUndefined();
  });

  it("refuses an existing folder with no .obsidian and keeps its files", async () => {
    await using scratch = await scratchFolder();
    const folder = join(scratch.path, "not-a-vault");
    await mkdir(folder);
    await writeFile(join(folder, "notes.md"), "keep me\n");

    await expect(purgeVault(folder)).rejects.toThrow(
      /refusing to purge a folder with no \.obsidian/,
    );
    expect(await exists(join(folder, "notes.md"))).toBe(true);
  });

  it("deletes a vault folder that has .obsidian and no tracked files", async () => {
    await using scratch = await scratchFolder();
    const folder = join(scratch.path, "vault");
    await mkdir(join(folder, ".obsidian"), { recursive: true });

    await purgeVault(folder);

    expect(await exists(folder)).toBe(false);
  });
});
