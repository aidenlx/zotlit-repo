import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "vite";

export const LAUNCH_LINK_ID = "zotlit-launch-link";
export const LAUNCH_LINK_KEY = "zotlit-e2e-launch-link";

const fixtureDir = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "launch-link-plugin",
);

const pluginDir = (vaultPath: string) =>
  join(vaultPath, ".obsidian", "plugins", LAUNCH_LINK_ID);

export async function installLaunchLinkPlugin(
  vaultPath: string,
): Promise<void> {
  const dir = pluginDir(vaultPath);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await build({
    configFile: false,
    root: fixtureDir,
    logLevel: "warn",
    build: {
      outDir: dir,
      emptyOutDir: false,
      target: "es2022",
      lib: {
        entry: join(fixtureDir, "main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: { external: ["obsidian"] },
    },
  });
  await copyFile(join(fixtureDir, "manifest.json"), join(dir, "manifest.json"));
}

export async function removeLaunchLinkPlugin(vaultPath: string): Promise<void> {
  await rm(pluginDir(vaultPath), { recursive: true, force: true });
}
