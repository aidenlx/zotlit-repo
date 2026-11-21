// The publish repository's tree for one plugin version: a thin shell that
// builds the plugin from its bundle package. Files that carry a version or a
// name are written here; the rest are copied from `templates/`.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { prerelease } from "semver";
import { $ } from "zx";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import {
  LEGAL_FILES,
  workspaceLicense,
  writeShellEntry,
} from "./bundle-package.ts";
import { PUBLISHED_PLUGINS } from "./plugins.ts";
import type { PublishedPlugin, PublishedPluginName } from "./plugins.ts";

import { parseManifest } from "#obsidian-manifest";

const TEMPLATES = join(import.meta.dirname, "templates");
const BUILD_SCRIPT = "scripts/build.mjs";
/** The build script of a Resource Pack's shell, which that shell carries as `BUILD_SCRIPT`. */
const CONTAINER_BUILD_SCRIPT = "scripts/build-container.mjs";
const RELEASE_WORKFLOW = ".github/workflows/plugin-release.yml";
/** The release workflow of a plugin with no Resource Release. */
const RELEASE_WORKFLOW_NO_RESOURCES =
  ".github/workflows/plugin-release-container.yml";

export interface ShellOptions {
  readonly plugin: PublishedPluginName;
  /** The plugin version, and so the bundle package version. */
  readonly version: string;
  /** The folder to write the tree into; its old content is removed. */
  readonly outDir: string;
  readonly workspaceRoot: string;
}

/** The exact version of a package as the build script resolves it. */
function installedVersion(name: string, from: string): string {
  const require = createRequire(from);
  const { version } = require(`${name}/package.json`) as { version: string };
  return version;
}

/**
 * The bundler the build script runs: Vite at the version this workspace
 * resolves for `scripts/build.mjs`, and the Rolldown that Vite runs. Both
 * decide the bytes of `main.js`, so the shell pins both.
 */
export function shellToolchain(): { vite: string; rolldown: string } {
  const buildScript = join(TEMPLATES, BUILD_SCRIPT);
  const vite = installedVersion("vite", buildScript);
  const vitePackage = createRequire(buildScript).resolve("vite/package.json");
  return { vite, rolldown: installedVersion("rolldown", vitePackage) };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The README of the publish repository: the workspace README, with its
 * relative image paths resolved on the source repository, and a section that
 * names where the source lives.
 */
export function shellReadme(
  readme: string,
  plugin: PublishedPlugin,
  name: string,
): string {
  const assets = `https://raw.githubusercontent.com/${SOURCE_REPOSITORY}/main/assets/`;
  const resolved = readme.replaceAll(
    /(src|srcset)="assets\//g,
    `$1="${assets}`,
  );
  const source = `The source code, the
issue tracker and the development history are in
[${SOURCE_REPOSITORY}](https://github.com/${SOURCE_REPOSITORY}). This tree is
generated at each release: send changes to the source repository.`;
  const section = plugin.container
    ? `## About this repository

This repository publishes ${name}: its releases. Its tree takes the pack from
the npm package
[\`${plugin.bundlePackage}\`](https://www.npmjs.com/package/${plugin.bundlePackage})
at the version that \`package.json\` names: \`pnpm install\`, then
\`pnpm run build\` copies \`main.js\` from the package, byte for byte. ${source}

`
    : `## About this repository

This repository publishes ${name}: its releases, and the Resource Releases
(\`res-<version>\`) that the plugin downloads at runtime. Its tree builds the
plugin from the npm package
[\`${plugin.bundlePackage}\`](https://www.npmjs.com/package/${plugin.bundlePackage})
at the version that \`package.json\` names: \`pnpm install\`, then
\`pnpm run build\` writes \`main.js\` and \`styles.css\`. ${source}

`;
  const footer = resolved.lastIndexOf("\n---\n");
  return footer === -1
    ? `${resolved.trimEnd()}\n\n${section}`
    : `${resolved.slice(0, footer + 1)}${section}${resolved.slice(footer + 1)}`;
}

/**
 * The `versions.json` of the shell: the plugin's own, with this version's
 * minimum Obsidian version when it is a stable release. Obsidian reads it
 * from the default branch, which carries stable releases only. A new
 * plugin's default branch holds its first beta shell until its first stable
 * release.
 */
function shellVersions(
  versions: Record<string, string>,
  manifest: { version: string; minAppVersion: string },
): Record<string, string> {
  return prerelease(manifest.version) === null
    ? { ...versions, [manifest.version]: manifest.minAppVersion }
    : versions;
}

function releaseWorkflow(template: string, plugin: PublishedPlugin): string {
  const title =
    '"${{ steps.meta.outputs.name }} v${{ steps.meta.outputs.version }}"';
  const notes = plugin.changelog
    ? `notes=$(printf '%s\\n\\n%s' \\
            ${title} \\
            "Release notes: ${plugin.changelog}\${{ steps.meta.outputs.version }}")`
    : `notes=${title}`;
  return template
    .replace("@@RESOURCES@@", plugin.resources ?? "")
    .replace("@@RELEASE_NOTES@@", notes);
}

const gitignore = (plugin: PublishedPlugin) => `node_modules/
# Written by \`pnpm run build\`, and uploaded to each release.
main.js
${plugin.container ? "" : "styles.css\n"}`;

/** Writes the shell tree for one plugin version into `outDir`. */
export async function generateShell(options: ShellOptions): Promise<void> {
  const { version, outDir, workspaceRoot } = options;
  const plugin: PublishedPlugin = PUBLISHED_PLUGINS[options.plugin];
  const app = await readJson<Record<string, unknown>>(
    join(workspaceRoot, plugin.app, "package.json"),
  );
  const manifest = parseManifest({ ...app, version });
  const rootPackage = await readJson<{ packageManager: string }>(
    join(workspaceRoot, "package.json"),
  );
  // A Resource Pack's shell copies main.js and runs no bundler.
  const toolchain = plugin.container ? undefined : shellToolchain();

  await rm(outDir, { recursive: true, force: true });
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(outDir, path)), { recursive: true });
    await writeFile(join(outDir, path), content);
  };

  await write("manifest.json", json(manifest));
  await write(
    "versions.json",
    json(
      shellVersions(
        await readJson(join(workspaceRoot, plugin.versions)),
        manifest,
      ),
    ),
  );
  await write(
    "README.md",
    shellReadme(
      await readFile(join(workspaceRoot, plugin.readme), "utf8"),
      plugin,
      manifest.name,
    ),
  );
  await write(
    "package.json",
    json({
      name: manifest.id,
      version,
      private: true,
      description: manifest.description,
      license: await workspaceLicense(workspaceRoot),
      repository: {
        type: "git",
        url: `https://github.com/${plugin.repository}`,
      },
      type: "module",
      scripts: { build: "node scripts/build.mjs" },
      dependencies: { [plugin.bundlePackage]: version },
      ...(toolchain ? { devDependencies: { vite: toolchain.vite } } : {}),
      packageManager: rootPackage.packageManager,
    }),
  );
  await write(
    "pnpm-workspace.yaml",
    `# The bundle package is published moments before this repository builds
# it, so the release-age delay leaves it out.
minimumReleaseAgeExclude:
  - "${plugin.bundlePackage}"
${
  toolchain
    ? `
# Vite and the Rolldown it runs decide the bytes of main.js. These are the
# versions ZotLit's own release build runs.
overrides:
  rolldown: ${toolchain.rolldown}
`
    : ""
}`,
  );
  if (!plugin.container) await writeShellEntry(outDir, plugin);
  await write(".gitignore", gitignore(plugin));

  for (const file of LEGAL_FILES) {
    await copyFile(join(workspaceRoot, file), join(outDir, file));
  }
  await mkdir(dirname(join(outDir, BUILD_SCRIPT)), { recursive: true });
  await copyFile(
    join(TEMPLATES, plugin.container ? CONTAINER_BUILD_SCRIPT : BUILD_SCRIPT),
    join(outDir, BUILD_SCRIPT),
  );
  if (plugin.giscus) {
    await copyFile(join(TEMPLATES, "giscus.json"), join(outDir, "giscus.json"));
  }
  await write(
    RELEASE_WORKFLOW,
    releaseWorkflow(
      await readFile(
        join(
          TEMPLATES,
          plugin.resources === undefined
            ? RELEASE_WORKFLOW_NO_RESOURCES
            : RELEASE_WORKFLOW,
        ),
        "utf8",
      ),
      plugin,
    ),
  );
}

/**
 * The `.npmrc` that routes the bundle package's scope to `registry`, for an
 * install from a registry other than npm's. The shell commits no `.npmrc`:
 * the publish repository installs from the public registry.
 */
export function scopeRegistryNpmrc(
  plugin: PublishedPluginName,
  registry: string,
): string {
  const scope = PUBLISHED_PLUGINS[plugin].bundlePackage.split("/")[0];
  return `${scope}:registry=${registry}\n`;
}

/**
 * Writes the shell's `pnpm-lock.yaml`. Without `bundleTarball`, pnpm resolves
 * the bundle package from the npm registry, as a release does after it
 * publishes the package. With it, an override installs that local tarball in
 * place of the registry version, as the local check does before anything is
 * published; the override then stays in `pnpm-workspace.yaml`. With
 * `registry`, the bundle package resolves from that registry, and the lockfile
 * keeps no URL of it, so it is the lockfile a resolve from npm writes.
 */
export async function lockShell(
  outDir: string,
  options: {
    plugin: PublishedPluginName;
    bundleTarball?: string;
    registry?: string;
  },
): Promise<void> {
  if (options.bundleTarball) {
    const { bundlePackage } = PUBLISHED_PLUGINS[options.plugin];
    const workspace = join(outDir, "pnpm-workspace.yaml");
    const text = await readFile(workspace, "utf8");
    // The override joins the shell's `overrides` block, the last of the file.
    const block = text.includes("\noverrides:\n") ? "" : "\noverrides:\n";
    await writeFile(
      workspace,
      `${text}${block}  "${bundlePackage}": "file:${options.bundleTarball}"\n`,
    );
  }
  const { registry } = options;
  if (!registry) {
    await $({ cwd: outDir, stdio: "inherit" })`pnpm install --lockfile-only`;
    return;
  }
  const npmrc = join(outDir, ".npmrc");
  await writeFile(npmrc, scopeRegistryNpmrc(options.plugin, registry));
  try {
    await $({ cwd: outDir, stdio: "inherit" })`pnpm install --lockfile-only`;
  } finally {
    await rm(npmrc, { force: true });
  }
  // pnpm records the tarball URL of a package from a registry other than its
  // default one. The URL of the stand-in registry has no place in the shell.
  const lockfile = join(outDir, "pnpm-lock.yaml");
  const marker = `, tarball: ${registry}`;
  const lines = (await readFile(lockfile, "utf8")).split("\n").map((line) => {
    const at = line.indexOf(marker);
    return at === -1
      ? line
      : line.slice(0, at) + line.slice(line.indexOf("}", at));
  });
  await writeFile(lockfile, lines.join("\n"));
}
