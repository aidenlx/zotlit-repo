// Compares two npm tarballs by the files they hold. Two packs of the same
// files can differ in their gzip bytes, so a published version is the same
// as a local build when every file path and every file's bytes match.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function fileHashes(dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const entry of await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    hashes.set(
      relative(dir, path),
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    );
  }
  return hashes;
}

/**
 * The files that differ between the tarballs `a` and `b`, by path; empty when
 * both hold the same files. Extracts them under `workDir`.
 */
export async function tarballDifferences(
  a: Buffer,
  b: Buffer,
  workDir: string,
): Promise<string[]> {
  const sides = await Promise.all(
    [a, b].map(async (bytes, index) => {
      const dir = join(workDir, `tarball-${index}`);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}.tgz`, bytes);
      await run("tar", ["-xzf", `${dir}.tgz`, "-C", dir]);
      return fileHashes(dir);
    }),
  );
  const [left, right] = sides as [Map<string, string>, Map<string, string>];
  const paths = new Set([...left.keys(), ...right.keys()]);
  return [...paths].filter((path) => left.get(path) !== right.get(path)).sort();
}
