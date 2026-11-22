#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getWorkspaceRoot } from "#package-roots";

interface VendoredSource {
  readonly repository: string;
  readonly dest: string;
  readonly paths: readonly string[];
  readonly next: string;
}

const SOURCES: Readonly<Record<string, VendoredSource>> = {
  "zotero-schema": {
    repository: "zotero/zotero-schema",
    dest: "packages/zotero-types/zotero-schema",
    paths: ["schema.json"],
    next: "Regenerate the item shapes: pnpm --filter @zotlit/zotero-types generate:fields (and the other generate:* scripts of that package).",
  },
  "pdfjs-dist": {
    repository: "zotero-plugin-dev/zotero-pdfjs-types",
    dest: "packages/pdfjs-dist",
    paths: ["types"],
    next: "Check the Companion types: turbo run typecheck --filter=@zotlit/zotero.",
  },
};

const [name, ref = "HEAD"] = process.argv.slice(2);
const source = name === undefined ? undefined : SOURCES[name];
if (source === undefined) {
  console.error(
    `Usage: node packages/scripts/scripts/vendor-upstream.ts <${Object.keys(SOURCES).join("|")}> [ref]`,
  );
  process.exit(2);
}

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const dest = join(workspaceRoot, source.dest);
const commit = await resolveCommit(source.repository, ref);
const work = await mkdtemp(join(tmpdir(), "zotlit-vendor-"));

try {
  const archive = join(work, "source.tar.gz");
  const tree = join(work, "tree");
  await download(
    `https://codeload.github.com/${source.repository}/tar.gz/${commit}`,
    archive,
  );
  await mkdir(tree);
  execFileSync("tar", ["-xzf", archive, "-C", tree, "--strip-components=1"]);

  for (const path of source.paths) {
    await rm(join(dest, path), { recursive: true, force: true });
    await cp(join(tree, path), join(dest, path), { recursive: true });
  }

  await writeFile(
    join(dest, "provenance.json"),
    `${JSON.stringify(
      {
        repository: `https://github.com/${source.repository}`,
        commit,
        paths: source.paths,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(`${source.dest}: ${source.repository} at ${commit}.`);
console.log(source.next);

async function resolveCommit(repository: string, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github.sha" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not resolve ${ref} in ${repository}: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.text()).trim();
}

async function download(url: string, file: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Download of ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}
