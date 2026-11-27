import AdmZip from "adm-zip";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { glob } from "tinyglobby";
import type { InlineConfig, LibraryFormats, Plugin } from "vite";
import { build } from "vite";

import { iconEntryPath, parseManifest } from "./manifest.ts";
import { updateUrl } from "./release-constants.ts";

type ZoteroPkg = typeof import("../package.json");

async function readPkg(pkgPath: string): Promise<ZoteroPkg> {
  return JSON.parse(await readFile(pkgPath, "utf-8")) as ZoteroPkg;
}

type BuildResult = Awaited<ReturnType<typeof build>>;
type BuildOutput = Exclude<BuildResult, { close: unknown }>;

async function addWatchTree(
  addWatchFile: (id: string) => void,
  dir: string,
): Promise<void> {
  addWatchFile(dir);
  const paths = await glob("**/*", {
    cwd: dir,
    absolute: true,
    dot: true,
    onlyFiles: false,
  });
  for (const path of paths) addWatchFile(path);
}

export interface ZoteroBuildEnv {
  mode: string;
  isProd: boolean;
  isDev: boolean;
  addonStaging: string;
  xpiOutDir: string;
}

export function resolveEnv(mode: string): ZoteroBuildEnv {
  const isProd = mode === "production";
  const isDev = mode === "development";
  return {
    mode,
    isProd,
    isDev,
    addonStaging: isProd ? "dist/addon" : "dist-dev/addon",
    xpiOutDir: isProd ? "dist" : "dist-dev",
  };
}

export interface ZoteroIifeBundleOpts {
  entry: string;
  iifeName: string;
  fileName: string;
  exports: readonly string[];
  emptyOutDir?: boolean;
  target?: string;
}

export function zoteroSandboxConfig(
  root: string,
  env: ZoteroBuildEnv,
  bundle: ZoteroIifeBundleOpts,
): InlineConfig {
  return {
    configFile: false,
    mode: env.mode,
    resolve: { tsconfigPaths: true },
    define: {
      __DEV__: JSON.stringify(env.isDev),
      "process.env.NODE_ENV": JSON.stringify(env.mode),
    },
    build: {
      lib: {
        entry: resolve(root, bundle.entry),
        formats: ["iife"] satisfies LibraryFormats[],
        name: bundle.iifeName,
        fileName: () => bundle.fileName,
      },
      outDir: env.addonStaging,
      emptyOutDir: bundle.emptyOutDir ?? false,
      sourcemap: false,
      minify: env.isProd,
      target: bundle.target ?? "es2022",
      copyPublicDir: false,
      rolldownOptions: {
        output: {
          banner: `/* GENERATED ${bundle.fileName} — DO NOT EDIT */`,
          footer: bundle.exports
            .map((name) => `var ${name} = ${bundle.iifeName}.${name};`)
            .join("\n"),
          codeSplitting: false,
        },
      },
    },
  };
}

export interface ZoteroBuildPluginOpts {
  root: string;
  env: ZoteroBuildEnv;
  bootstrapBundle: ZoteroIifeBundleOpts;
}

export function zoteroBuildPlugin({
  root,
  env,
  bootstrapBundle,
}: ZoteroBuildPluginOpts): Plugin {
  const { addonStaging, xpiOutDir, isProd } = env;
  const pkgPath = join(root, "package.json");
  const addonSrcDir = join(root, "addon");
  const addonDistDir = join(root, addonStaging);
  const bootstrapEntryPath = resolve(root, bootstrapBundle.entry);
  const xpiAbsoluteOutDir = join(root, xpiOutDir);

  return {
    name: "zotero-build",
    async buildStart() {
      await rm(addonDistDir, { recursive: true, force: true });

      this.addWatchFile(pkgPath);
      this.addWatchFile(bootstrapEntryPath);
      await addWatchTree(this.addWatchFile.bind(this), addonSrcDir);

      const { zotero } = await readPkg(pkgPath);
      this.addWatchFile(resolve(root, zotero.icon));

      const result = (await build(
        zoteroSandboxConfig(root, env, bootstrapBundle),
      )) as BuildOutput;
      const outputs = Array.isArray(result) ? result : [result];
      for (const { output } of outputs) {
        for (const chunk of output) {
          if (chunk.type !== "chunk") continue;
          for (const id of chunk.moduleIds) this.addWatchFile(id);
        }
      }
    },
    async writeBundle() {
      const pkg = await readPkg(pkgPath);

      const manifest = parseManifest(pkg, updateUrl(pkg.version));

      await cp(addonSrcDir, addonDistDir, { recursive: true });

      const iconDest = join(addonDistDir, iconEntryPath(pkg.zotero.icon));
      await mkdir(dirname(iconDest), { recursive: true });
      await cp(resolve(root, pkg.zotero.icon), iconDest);

      await writeFile(
        join(addonDistDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      if (isProd || !this.meta.watchMode) {
        const xpiName = isProd
          ? `zotlit-zotero-${pkg.version}.xpi`
          : `zotlit-zotero-${pkg.version}-dev.xpi`;
        await mkdir(xpiAbsoluteOutDir, { recursive: true });
        const xpiPath = join(xpiAbsoluteOutDir, xpiName);
        const zip = new AdmZip();
        zip.addLocalFolder(addonDistDir);
        zip.writeZip(xpiPath);
        console.log(`Wrote ${xpiName}`);
      }
    },
  };
}
