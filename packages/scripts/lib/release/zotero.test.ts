import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SourceTags } from "./obsidian.ts";
import { publishZotero, UPDATE_HOST_TAG } from "./zotero.ts";
import type { ReleaseHost } from "./zotero.ts";

let root: string;
let dist: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "zt-companion-"));
  dist = join(root, "apps/zotero/dist");
  await mkdir(dist, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

type Releases = Map<string, Map<string, string>>;

function fakeHost(releases: Releases, calls: string[]): ReleaseHost {
  const upload = async (tag: string, files: readonly string[]) => {
    for (const file of files) {
      releases.get(tag)!.set(basename(file), await readFile(file, "utf8"));
    }
  };
  return {
    assets: async (tag) => {
      const release = releases.get(tag);
      return release ? [...release.keys()] : undefined;
    },
    create: async (tag, release, files) => {
      calls.push(`create ${tag}${release.prerelease ? " pre-release" : ""}`);
      releases.set(tag, new Map());
      await upload(tag, files);
    },
    upload: async (tag, files) => {
      calls.push(
        `upload ${tag} ${files.map((file) => basename(file)).join(" ")}`,
      );
      await upload(tag, files);
    },
    download: async (tag, pattern, dir) => {
      const release = releases.get(tag);
      if (!release) throw new Error(`release not found: ${tag}`);
      calls.push(`download ${tag} ${pattern}`);
      for (const [name, text] of release) {
        if (
          name === pattern ||
          (pattern.includes("*") && name.startsWith("update"))
        ) {
          await writeFile(join(dir, name), text);
        }
      }
    },
    editHost: async (tag) => {
      calls.push(`edit ${tag}`);
    },
  };
}

function memoryTags(tags: Map<string, string>): SourceTags {
  return {
    get: async (tag) => tags.get(tag),
    push: async (tag, commit) => {
      tags.set(tag, commit);
    },
  };
}

async function publish(
  releases: Releases,
  tags: Map<string, string>,
  build: string,
) {
  const calls: string[] = [];
  await publishZotero({
    workspaceRoot: root,
    version: "2.3.0-beta.0",
    changelogVersion: "2.3.0-beta.0",
    sourceCommit: "c0ffee",
    build: () => writeFile(join(dist, "zotlit-zotero-2.3.0-beta.0.xpi"), build),
    buildUpdateManifests: async () => {
      const xpi = await readFile(
        join(dist, "zotlit-zotero-2.3.0-beta.0.xpi"),
        "utf8",
      );
      await writeFile(join(dist, "update-beta.json"), `{"hash":"${xpi}"}`);
      await writeFile(join(dist, "release-host-notes.md"), "notes");
    },
    host: fakeHost(releases, calls),
    sourceTags: memoryTags(tags),
    say: () => {},
  });
  return calls;
}

const withHost = (): Releases =>
  new Map([[UPDATE_HOST_TAG, new Map([["update-beta.json", "{}"]])]]);

describe("publishZotero", () => {
  it("creates the release before the update channel names its XPI, then tags the source", async () => {
    const releases = withHost();
    const tags = new Map<string, string>();

    const calls = await publish(releases, tags, "first build");

    expect(calls).toEqual([
      "create zt-2.3.0-beta.0 pre-release",
      `download ${UPDATE_HOST_TAG} update*.json`,
      `edit ${UPDATE_HOST_TAG}`,
      `upload ${UPDATE_HOST_TAG} update-beta.json`,
    ]);
    expect(releases.get(UPDATE_HOST_TAG)!.get("update-beta.json")).toBe(
      '{"hash":"first build"}',
    );
    expect(tags.get("zt-2.3.0-beta.0")).toBe("c0ffee");
  });

  it("on a second run, hashes the XPI users download, not the new build", async () => {
    const releases = withHost();
    releases.set(
      "zt-2.3.0-beta.0",
      new Map([["zotlit-zotero-2.3.0-beta.0.xpi", "first build"]]),
    );

    const calls = await publish(releases, new Map(), "second build");

    expect(calls).not.toContain("create zt-2.3.0-beta.0 pre-release");
    expect(releases.get(UPDATE_HOST_TAG)!.get("update-beta.json")).toBe(
      '{"hash":"first build"}',
    );
  });

  it("stops before any channel changes when the rolling release is missing", async () => {
    const releases: Releases = new Map();

    await expect(publish(releases, new Map(), "build")).rejects.toThrow(
      /release not found/,
    );
  });

  it("stops at a source tag on another commit, which a person checks", async () => {
    const tags = new Map([["zt-2.3.0-beta.0", "0ther"]]);

    await expect(publish(withHost(), tags, "build")).rejects.toThrow(
      /not on c0ffee/,
    );
  });
});
