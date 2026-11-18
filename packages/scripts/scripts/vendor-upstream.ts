#!/usr/bin/env node
// Refreshes a vendored upstream tree from GitHub at one commit, and records
// that commit in the `provenance.json` next to the files.
//
//   node packages/scripts/scripts/vendor-upstream.ts <source> [ref]
//
// `<source>` names an entry of `SOURCES`. `[ref]` is a commit, branch or tag of
// the upstream repository; it defaults to the upstream default branch. The
// script replaces each vendored path with the upstream copy, so a review of the
// git diff shows every upstream change.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getWorkspaceRoot } from "#package-roots";

interface VendoredSource {
  /** GitHub repository, as `owner/name`. */
  readonly repository: string;
  /** Folder that holds the copy and its `provenance.json`, from the workspace root. */
  readonly dest: string;
  /** Upstream paths to copy, the same relative path in `dest`. */
  readonly paths: readonly string[];
  /** What to run after a refresh, so the copy's consumers follow it. */
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

/** The full commit SHA that `ref` names in `repository`. */
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
