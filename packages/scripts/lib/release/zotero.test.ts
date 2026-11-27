import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SourceTags } from "./obsidian.ts";
import type { ReleaseHost } from "./zotero.ts";
import { publishZotero, UPDATE_HOST_TAG } from "./zotero.ts";

import { getWorkspaceRoot } from "#package-roots";

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
      `download ${UPDATE_HOST_TAG} update*.json`,
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

  it("skips channel uploads when the generated manifests have the same bytes", async () => {
    const releases = withHost();
    releases
      .get(UPDATE_HOST_TAG)!
      .set("update-beta.json", '{"hash":"same build"}');

    const calls = await publish(releases, new Map(), "same build");

    expect(
      calls.some((call) => call.startsWith(`upload ${UPDATE_HOST_TAG} `)),
    ).toBe(false);
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

describe("overlapping Companion publishes", () => {
  const run = promisify(execFile);
  const addonId = "companion@example.test";
  const stableManifest = "update.json";
  const betaManifest = "update-beta.json";
  const stableVersion = "2.2.1";

  function seedChannels(betaVersion: string): Releases {
    const manifest = (version: string) =>
      JSON.stringify({ addons: { [addonId]: { updates: [{ version }] } } });
    return new Map([
      [
        UPDATE_HOST_TAG,
        new Map([
          [stableManifest, manifest("2.2.0")],
          [betaManifest, manifest(betaVersion)],
        ]),
      ],
    ]);
  }

  function manifestVersion(body: string) {
    const manifest = JSON.parse(body) as {
      addons: Record<string, { updates: { version: string }[] }>;
    };
    return manifest.addons[addonId]!.updates[0]!.version;
  }

  async function publishWithGenerator(options: {
    workspaceRoot: string;
    version: string;
    host: ReleaseHost;
    sourceTags: SourceTags;
  }) {
    const { version, workspaceRoot } = options;
    const sourceRoot = await getWorkspaceRoot(import.meta.dirname);
    const source = join(sourceRoot, "apps/zotero");
    const companion = join(workspaceRoot, "apps/zotero");
    const scripts = join(companion, "scripts");
    const targetDist = join(companion, "dist");
    await mkdir(scripts, { recursive: true });
    await mkdir(targetDist, { recursive: true });
    for (const file of [
      "build-update-json.ts",
      "release-constants.ts",
      "release-host-notes.eta",
    ]) {
      await cp(join(source, "scripts", file), join(scripts, file));
    }
    await symlink(
      join(source, "node_modules"),
      join(companion, "node_modules"),
    );
    await writeFile(
      join(companion, "package.json"),
      JSON.stringify({ type: "module", version, zotero: { id: addonId } }),
    );
    await publishZotero({
      ...options,
      changelogVersion: version,
      sourceCommit: `commit-${version}`,
      build: () =>
        writeFile(join(targetDist, `zotlit-zotero-${version}.xpi`), version),
      buildUpdateManifests: async () => {
        await run(process.execPath, [join(scripts, "build-update-json.ts")], {
          cwd: workspaceRoot,
          env: { ...process.env, GITHUB_OUTPUT: "" },
        });
      },
      say: () => {},
    });
  }

  it("keeps the hosted beta update when the local stable hotfix resumes", async () => {
    const releases = seedChannels("2.3.0-beta.0");
    const channels = releases.get(UPDATE_HOST_TAG)!;
    const betaBefore = channels.get(betaManifest)!;
    const stableCalls: string[] = [];
    const host = fakeHost(releases, stableCalls);
    const sourceTags = memoryTags(new Map());
    const stableGenerated = Promise.withResolvers<void>();
    const resumeStable = Promise.withResolvers<void>();
    const stable = publishWithGenerator({
      workspaceRoot: root,
      version: stableVersion,
      sourceTags,
      host: {
        ...host,
        editHost: async (tag, metadata) => {
          stableGenerated.resolve();
          await resumeStable.promise;
          await host.editHost(tag, metadata);
        },
      },
    });
    try {
      await Promise.race([stableGenerated.promise, stable]);
      expect(await readFile(join(dist, betaManifest), "utf8")).toBe(betaBefore);
      expect(
        manifestVersion(await readFile(join(dist, stableManifest), "utf8")),
      ).toBe(stableVersion);

      await publishWithGenerator({
        workspaceRoot: join(root, "beta"),
        version: "2.3.0-beta.1",
        sourceTags,
        host: fakeHost(releases, []),
      });
      expect(manifestVersion(channels.get(betaManifest)!)).toBe("2.3.0-beta.1");
    } finally {
      resumeStable.resolve();
      await stable;
    }
    expect(manifestVersion(channels.get(betaManifest)!)).toBe("2.3.0-beta.1");
    expect(
      stableCalls.some(
        (call) =>
          call.startsWith(`upload ${UPDATE_HOST_TAG} `) &&
          call.split(" ").includes(betaManifest),
      ),
    ).toBe(false);
  });

  it("carries a stable release into the beta channel when it is newer", async () => {
    const releases = seedChannels("2.2.1-beta.0");

    await publishWithGenerator({
      workspaceRoot: root,
      version: stableVersion,
      sourceTags: memoryTags(new Map()),
      host: fakeHost(releases, []),
    });

    const channels = releases.get(UPDATE_HOST_TAG)!;
    expect(manifestVersion(channels.get(stableManifest)!)).toBe(stableVersion);
    expect(manifestVersion(channels.get(betaManifest)!)).toBe(stableVersion);
  });

  it("stops an earlier beta publish when a newer beta reaches the host", async () => {
    const releases = seedChannels("2.3.0-beta.0");
    const calls: string[] = [];
    const host = fakeHost(releases, calls);
    const sourceTags = memoryTags(new Map());
    const earlierGenerated = Promise.withResolvers<void>();
    const resumeEarlier = Promise.withResolvers<void>();
    const earlier = publishWithGenerator({
      workspaceRoot: root,
      version: "2.3.0-beta.1",
      sourceTags,
      host: {
        ...host,
        editHost: async (tag, metadata) => {
          earlierGenerated.resolve();
          await resumeEarlier.promise;
          await host.editHost(tag, metadata);
        },
      },
    });
    try {
      await Promise.race([earlierGenerated.promise, earlier]);
      await publishWithGenerator({
        workspaceRoot: join(root, "newer"),
        version: "2.3.0-beta.2",
        sourceTags,
        host: fakeHost(releases, []),
      });
    } finally {
      resumeEarlier.resolve();
      await Promise.allSettled([earlier]);
    }

    await expect
      .soft(earlier)
      .rejects.toThrow(
        "Another publish updated update-beta.json to 2.3.0-beta.2 after this run downloaded it. This run has 2.3.0-beta.1. Run the publish again.",
      );
    const channels = releases.get(UPDATE_HOST_TAG)!;
    expect
      .soft(manifestVersion(channels.get(betaManifest)!))
      .toBe("2.3.0-beta.2");
    expect(
      calls.some((call) => call.startsWith(`upload ${UPDATE_HOST_TAG} `)),
    ).toBe(false);
  });
});
