#!/usr/bin/env node
// Compares each format version at HEAD with the latest release tag. Both are
// git objects, not working-tree files, so Turbo cannot hash them: the
// `//#lint:format-versions` task in turbo.json stays uncached. A file that
// moved since the release is read at the release under its old path.
import { execFileSync } from "node:child_process";

import {
  compareFormatVersion,
  formatVersions,
  latestReleaseTag,
  readFormatVersion,
} from "#format-versions";
import { getWorkspaceRoot } from "#package-roots";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });

try {
  const release = latestReleaseTag(git("tag", "--list").trim().split("\n"));
  const releasedFiles = new Set(
    git("ls-tree", "-r", "--name-only", "-z", release).split("\0"),
  );
  // `R<score>\0<old>\0<new>\0` for each file renamed since the release.
  const renames = git(
    "diff",
    "--name-status",
    "-M",
    "--diff-filter=R",
    "-z",
    release,
    "HEAD",
  ).split("\0");
  const releasedPath = new Map<string, string>();
  for (let i = 0; i + 2 < renames.length; i += 3)
    releasedPath.set(renames[i + 2]!, renames[i + 1]!);
  const errors: string[] = [];
  for (const entry of formatVersions) {
    const released = releasedFiles.has(entry.file)
      ? entry.file
      : releasedPath.get(entry.file);
    const head = readFormatVersion(
      git("show", `HEAD:${entry.file}`),
      entry.constant,
    );
    const releasedVersion =
      released === undefined
        ? null
        : readFormatVersion(
            git("show", `${release}:${released}`),
            entry.constant,
          );
    const error = compareFormatVersion(entry, head, releasedVersion);
    if (error) errors.push(error);
  }
  if (errors.length)
    throw new Error(`Released baseline: ${release}\n${errors.join("\n")}`);
  console.log(
    `check-format-versions: ${formatVersions.length} formats checked against ${release}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
