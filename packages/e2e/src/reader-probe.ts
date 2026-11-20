import type { ProbeData } from "@e2e-fixtures/reader-probe-plugin/main.ts";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "vite";

export const PROBE_ID = "zotlit-reader-probe";
export const PROBE_LAYER = "probe-band";

const packageRoot = resolve(import.meta.dirname, "..");
const fixtureDir = join(packageRoot, "fixtures", "reader-probe-plugin");

export function probePluginDir(vaultPath: string): string {
  return join(vaultPath, ".obsidian", "plugins", PROBE_ID);
}

export async function installReaderProbe(vaultPath: string): Promise<void> {
  const pluginDir = probePluginDir(vaultPath);
  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(pluginDir, { recursive: true });
  await build({
    configFile: false,
    root: fixtureDir,
    logLevel: "warn",
    resolve: { alias: { react: "preact/compat" } },
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: pluginDir,
      emptyOutDir: false,
      target: "es2022",
      lib: {
        entry: join(fixtureDir, "main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      rollupOptions: { external: ["obsidian", "electron"] },
    },
  });
  await copyFile(join(fixtureDir, "layout.css"), join(pluginDir, "styles.css"));
  await copyFile(
    join(fixtureDir, "manifest.json"),
    join(pluginDir, "manifest.json"),
  );
}

export async function writeProbeData(
  vaultPath: string,
  data: ProbeData,
): Promise<void> {
  await writeFile(
    join(probePluginDir(vaultPath), "data.json"),
    JSON.stringify(data),
  );
}

export async function removeReaderProbe(vaultPath: string): Promise<void> {
  await rm(probePluginDir(vaultPath), { recursive: true, force: true });
}
