import type { ProbeData } from "@e2e-fixtures/reader-probe-plugin/main.ts";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { build } from "vite";

import { gitInputs, newerInput } from "./bundle-freshness.ts";

export const PROBE_ID = "zotlit-reader-probe";
export const PROBE_LAYER = "probe-band";

const REGENERATE = "pnpm exec turbo run generate --filter=@zotlit/pdf-reader";
const packageRoot = resolve(import.meta.dirname, "..");
const fixtureDir = join(packageRoot, "fixtures", "reader-probe-plugin");

function readerStyles(workspaceRoot: string): string {
  return join(
    workspaceRoot,
    "packages",
    "pdf-reader",
    "src",
    "generated",
    "styles.css",
  );
}

async function assertReaderGeneratedFresh(
  workspaceRoot: string,
): Promise<void> {
  const packageDir = join(workspaceRoot, "packages", "pdf-reader");
  const output = readerStyles(workspaceRoot);
  const generated = await stat(output).catch(() => null);
  if (!generated) {
    throw new Error(
      `No generated reader assets at ${relative(workspaceRoot, output)}. Generate them:\n  ${REGENERATE}`,
    );
  }
  const newer = newerInput(
    generated.mtimeMs,
    await gitInputs(workspaceRoot, [
      join(packageDir, "src"),
      join(packageDir, "build"),
      join(workspaceRoot, "packages", "pdfjs", "dist"),
      join(workspaceRoot, "messages", "en.json"),
    ]),
  );
  if (newer) {
    throw new Error(
      `The generated reader assets ${relative(workspaceRoot, output)} are older than ${newer.path}. Regenerate them:\n  ${REGENERATE}`,
    );
  }
}

export function probePluginDir(vaultPath: string): string {
  return join(vaultPath, ".obsidian", "plugins", PROBE_ID);
}

export async function installReaderProbe(
  workspaceRoot: string,
  vaultPath: string,
): Promise<void> {
  await assertReaderGeneratedFresh(workspaceRoot);
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
  const readerCss = await readFile(readerStyles(workspaceRoot), "utf8");
  const layoutCss = await readFile(join(fixtureDir, "layout.css"), "utf8");
  await writeFile(join(pluginDir, "styles.css"), `${readerCss}\n${layoutCss}`);
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
