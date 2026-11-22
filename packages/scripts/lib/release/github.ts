import { $ } from "zx";

import type { SourceTags } from "./obsidian.ts";
import type { Outward } from "./outward.ts";
import { parseRemoteTags } from "./plan.ts";
import type { ReleaseHost } from "./zotero.ts";

export function ghReleaseHost(options: {
  repo: string;
  outward: Outward;
  token?: string;
}): ReleaseHost {
  const { repo, outward } = options;
  const env = options.token ? { GH_TOKEN: options.token } : undefined;
  const gh = $({ quiet: true, env: { ...process.env, ...env } });
  return {
    async assets(tag) {
      const view = await gh({
        nothrow: true,
      })`gh release view ${tag} --repo ${repo} --json assets`;
      if (view.exitCode !== 0) {
        if (/release not found/i.test(view.stderr)) return undefined;
        throw new Error(`gh release view ${tag} failed: ${view.stderr.trim()}`);
      }
      const { assets } = JSON.parse(view.stdout) as {
        assets: { name: string }[];
      };
      return assets.map(({ name }) => name);
    },
    create: (tag, release, files) =>
      outward.run({
        command: [
          "gh",
          "release",
          "create",
          tag,
          "--repo",
          repo,
          "--target",
          "main",
          "--title",
          release.title,
          "--notes",
          release.notes,
          release.prerelease ? "--prerelease" : "--latest=false",
          ...files,
        ],
        ...(env ? { env } : {}),
      }),
    upload: (tag, files) =>
      outward.run({
        command: [
          "gh",
          "release",
          "upload",
          tag,
          ...files,
          "--clobber",
          "--repo",
          repo,
        ],
        ...(env ? { env } : {}),
      }),
    download: async (tag, pattern, dir) => {
      await gh`gh release download ${tag} --repo ${repo} --pattern ${pattern} --dir ${dir} --clobber`;
    },
    editHost: (tag, host) =>
      outward.run({
        command: [
          "gh",
          "release",
          "edit",
          tag,
          "--repo",
          repo,
          "--title",
          host.title,
          "--notes-file",
          host.notesFile,
          "--prerelease",
          "--latest=false",
        ],
        ...(env ? { env } : {}),
      }),
  };
}

export function gitSourceTags(options: {
  cwd: string;
  outward: Outward;
  remote?: string;
}): SourceTags {
  const { cwd, outward, remote = "origin" } = options;
  return {
    async get(tag) {
      const listed = (
        await $({
          cwd,
          quiet: true,
        })`git ls-remote --tags ${remote} ${`refs/tags/${tag}`}`
      ).stdout;
      if (!parseRemoteTags(listed).has(tag)) return undefined;
      const lines = listed.split("\n").filter(Boolean);
      const peeled = lines.find((line) => line.endsWith(`refs/tags/${tag}^{}`));
      return (peeled ?? lines[0])!.split("\t")[0];
    },
    push: (tag, commit) =>
      outward.run({
        command: ["git", "push", remote, `${commit}:refs/tags/${tag}`],
        cwd,
      }),
  };
}
