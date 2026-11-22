import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { releaseLine, releaseTag } from "./lines.ts";
import { pushSourceTag } from "./obsidian.ts";
import type { SourceTags } from "./obsidian.ts";

export const UPDATE_HOST_TAG = "zotero-release";
const UPDATE_MANIFESTS = "update*.json";
const HOST_NOTES = "release-host-notes.md";

export interface ReleaseHost {
  assets(tag: string): Promise<string[] | undefined>;
  create(
    tag: string,
    release: { title: string; notes: string; prerelease: boolean },
    files: readonly string[],
  ): Promise<void>;
  upload(tag: string, files: readonly string[]): Promise<void>;
  download(tag: string, pattern: string, dir: string): Promise<void>;
  editHost(
    tag: string,
    host: { title: string; notesFile: string },
  ): Promise<void>;
}

export interface ZoteroPublish {
  workspaceRoot: string;
  version: string;
  changelogVersion: string;
  sourceCommit: string;
  build: () => Promise<void>;
  buildUpdateManifests: () => Promise<void>;
  host: ReleaseHost;
  sourceTags: SourceTags;
  say: (line: string) => void;
}

export async function publishZotero(options: ZoteroPublish): Promise<void> {
  const { workspaceRoot, version, host, say } = options;
  const dist = join(workspaceRoot, "apps/zotero/dist");
  const tag = releaseTag("zotero", version);
  const step = (name: string) => say(`\n▸ ${name}`);

  step("build: apps/zotero");
  await options.build();
  const xpis = (await readdir(dist)).filter((file) =>
    file.endsWith(`-${version}.xpi`),
  );
  if (xpis.length !== 1) {
    throw new Error(
      `Expected one XPI of ${version} in ${dist}, found ${xpis.length}.`,
    );
  }
  const xpi = xpis[0]!;

  step(`release: ${tag}`);
  const assets = await host.assets(tag);
  if (!assets) {
    await host.create(
      tag,
      {
        title: tag,
        notes: `ZotLit Zotero companion v${version}\n\nRelease notes: https://zotlit.aidenlx.site/changelog/${options.changelogVersion}`,
        prerelease: releaseLine(version) === "beta",
      },
      [join(dist, xpi)],
    );
  } else if (assets.includes(xpi)) {
    say(`${tag} has ${xpi}; the update manifests hash that file.`);
    await host.download(tag, xpi, dist);
  } else {
    await host.upload(tag, [join(dist, xpi)]);
  }

  step(`update manifests: from ${UPDATE_HOST_TAG}`);
  await host.download(UPDATE_HOST_TAG, UPDATE_MANIFESTS, dist);
  await options.buildUpdateManifests();

  step(`update channel: ${UPDATE_HOST_TAG}`);
  await host.editHost(UPDATE_HOST_TAG, {
    title: "Release Manifest",
    notesFile: join(dist, HOST_NOTES),
  });
  const manifests = (await readdir(dist))
    .filter((file) => file.startsWith("update") && file.endsWith(".json"))
    .map((file) => join(dist, file));
  await host.upload(UPDATE_HOST_TAG, manifests);

  step(`source tag: ${tag} on ${options.sourceCommit.slice(0, 12)}`);
  await pushSourceTag({
    tags: options.sourceTags,
    tag,
    commit: options.sourceCommit,
    say,
  });
}
