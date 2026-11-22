import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inc, prerelease } from "semver";
import type { Plugin } from "vite";

import { writeBundlePackage, writeShellEntry } from "./bundle-package.ts";
import type { PublishedPlugin } from "./plugins.ts";
import { BUNDLE_PACKAGE_DIR } from "./plugins.ts";
import { buildPlugin as copyContainer } from "./templates/scripts/build-container.mjs";
import { buildPlugin } from "./templates/scripts/build.mjs";

import { DEV_VAULT_CASE_ENV, getDevVaultDir } from "#dev-vault";
import { parseManifest } from "#obsidian-manifest";

export function deriveDevVersion(release: string): string {
  return prerelease(release) === null
    ? `${inc(release, "patch")}-dev`
    : `${release}.dev`;
}

function getDevVaultPluginDir(workspaceRoot: string, pluginId: string) {
  return join(
    getDevVaultDir(workspaceRoot, process.env[DEV_VAULT_CASE_ENV]),
    ".obsidian",
    "plugins",
    pluginId,
  );
}

interface HostBuild {
  readonly packageRoot: string;
  readonly workspaceRoot: string;
  readonly plugin: PublishedPlugin;
  readonly stageResources?: (dir: string) => Promise<void>;
}

async function buildFromBundlePackage(
  host: HostBuild & { readonly bundleDir: string; readonly outDir: string },
  packageJson: {
    version: string;
    description: string;
    author: string;
    obsidian: { name: string };
  },
): Promise<void> {
  const { plugin, workspaceRoot, bundleDir, outDir } = host;
  await writeBundlePackage({
    plugin,
    app: packageJson,
    dir: bundleDir,
    workspaceRoot,
  });
  await host.stageResources?.(join(bundleDir, "resources"));
  const entry = await writeShellEntry(join(outDir, "shell"), plugin);
  await buildPlugin({
    entry,
    styles: join(bundleDir, "styles.css"),
    outDir,
    alias: { [plugin.bundlePackage]: join(bundleDir, "main.js") },
  });
}

export async function buildContainerFromBundlePackage(
  host: HostBuild & { readonly main: Uint8Array },
  packageJson: Parameters<typeof buildFromBundlePackage>[1],
): Promise<void> {
  const outDir = join(host.packageRoot, "dist");
  const bundleDir = join(host.packageRoot, BUNDLE_PACKAGE_DIR);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, "main.js"), host.main);
  await writeBundlePackage({
    plugin: host.plugin,
    app: packageJson,
    dir: bundleDir,
    workspaceRoot: host.workspaceRoot,
  });
  await copyContainer({ main: join(bundleDir, "main.js"), outDir });
}

export function obsidianBuildPlugin({
  isDev,
  isProd,
  ...host
}: HostBuild & {
  isDev: boolean;
  isProd: boolean;
  outDir: string;
  bundleDir: string;
}): Plugin {
  const { outDir } = host;
  const packageJsonPath = join(host.packageRoot, "package.json");
  return {
    name: "obsidian-build",
    buildStart() {
      this.addWatchFile(packageJsonPath);
    },
    async writeBundle() {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
      if (isProd) await buildFromBundlePackage(host, packageJson);

      const manifestJson = parseManifest(packageJson);
      if (isDev) manifestJson.version = deriveDevVersion(manifestJson.version);
      await writeFile(
        join(outDir, "manifest.json"),
        JSON.stringify(manifestJson, null, 2),
      );
      console.log(`Using manifest v${manifestJson.version}`);

      await writeFile(join(outDir, ".hotreload"), "");

      const devVaultPluginDir = getDevVaultPluginDir(
        host.workspaceRoot,
        manifestJson.id,
      );
      try {
        await mkdir(devVaultPluginDir, { recursive: true });
        const assets = ["main.js", "manifest.json", ".hotreload"];
        await Promise.all(
          assets.map((name) =>
            cp(join(outDir, name), join(devVaultPluginDir, name)),
          ),
        );
        await cp(
          join(outDir, "styles.css"),
          join(devVaultPluginDir, "styles.css"),
        ).catch((err) => {
          if (err.code !== "ENOENT") throw err;
        });
        console.log(`Copied to dev vault: ${devVaultPluginDir}`);
      } catch (err) {
        console.warn("Failed to copy to dev vault:", err);
      }
    },
  };
}
