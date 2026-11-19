// The publish of one ZotLit Companion version to the publish repository:
//
//   build ─▶ release zt-<v> ─▶ update manifests ─▶ update channel ─▶ source tag
//
//   build             the Companion's production build: the XPI
//   release           the release zt-<v> with the XPI
//   update manifests  update.json and update-beta.json from the rolling
//                     release, with this version where it is newer
//   update channel    the rolling release takes the new manifests
//   source tag        zt-<v> in the source repository, on the source commit
//
// The release exists before a manifest names its XPI. A second run reuses
// what the first one published: when zt-<v> has its XPI, that XPI, not the new
// build, is what the manifests hash, so they match the file users download.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { releaseLine, releaseTag } from "./lines.ts";
import { pushSourceTag } from "./obsidian.ts";
import type { SourceTags } from "./obsidian.ts";

/** The rolling release whose assets are the Companion's update manifests. */
export const UPDATE_HOST_TAG = "zotero-release";
const UPDATE_MANIFESTS = "update*.json";
/** The notes of the rolling release, which the manifest build writes. */
const HOST_NOTES = "release-host-notes.md";

/** The releases of the publish repository. */
export interface ReleaseHost {
  /** The asset names of the release `tag`, or undefined when it does not exist. */
  assets(tag: string): Promise<string[] | undefined>;
  create(
    tag: string,
    release: { title: string; notes: string; prerelease: boolean },
    files: readonly string[],
  ): Promise<void>;
  /** Uploads `files`, replacing assets of the same name. */
  upload(tag: string, files: readonly string[]): Promise<void>;
  /** Downloads the assets that match `pattern` into `dir`, replacing files there. */
  download(tag: string, pattern: string, dir: string): Promise<void>;
  /** Sets the rolling release's title and notes; it stays a pre-release, never "Latest". */
  editHost(
    tag: string,
    host: { title: string; notesFile: string },
  ): Promise<void>;
}

export interface ZoteroPublish {
  workspaceRoot: string;
  version: string;
  /** The plugin version, whose changelog entry the release notes link. */
  changelogVersion: string;
  sourceCommit: string;
  build: () => Promise<void>;
  /** Writes the update manifests and the host notes into `dist/` from the XPI there. */
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
  // A missing rolling release fails here, before any channel changes.
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
