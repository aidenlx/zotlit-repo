import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { prerelease } from "semver";
import { $ } from "zx";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";

import { workspaceLicense, writeShellEntry } from "./bundle-package.ts";
import { LEGAL_FILES } from "./legal-files.ts";
import { PUBLISHED_PLUGINS } from "./plugins.ts";
import type { PublishedPlugin, PublishedPluginName } from "./plugins.ts";
import { SHELL_BUILD_SCRIPT, SHELL_RELEASE_WORKFLOW } from "./profiles.ts";

import { parseManifest } from "#obsidian-manifest";

const TEMPLATES = join(import.meta.dirname, "templates");

export interface ShellOptions {
  readonly plugin: PublishedPluginName;
  readonly version: string;
  readonly outDir: string;
  readonly workspaceRoot: string;
}

function installedVersion(name: string, from: string): string {
  const require = createRequire(from);
  const { version } = require(`${name}/package.json`) as { version: string };
  return version;
}

export function shellToolchain(): { vite: string; rolldown: string } {
  const buildScript = join(TEMPLATES, SHELL_BUILD_SCRIPT);
  const vite = installedVersion("vite", buildScript);
  const vitePackage = createRequire(buildScript).resolve("vite/package.json");
  return { vite, rolldown: installedVersion("rolldown", vitePackage) };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

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
  const section = `## About this repository

${plugin.profile.aboutRepository({ name, bundlePackage: plugin.bundlePackage })} ${source}

`;
  const footer = resolved.lastIndexOf("\n---\n");
  return footer === -1
    ? `${resolved.trimEnd()}\n\n${section}`
    : `${resolved.slice(0, footer + 1)}${section}${resolved.slice(footer + 1)}`;
}

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
  return Object.entries(plugin.profile.workflowValues).reduce(
    (workflow, [name, value]) => workflow.replace(`@@${name}@@`, value),
    template.replace("@@RELEASE_NOTES@@", notes),
  );
}

const gitignore = (plugin: PublishedPlugin) => `node_modules/
# Written by \`pnpm run build\`, and uploaded to each release.
${plugin.profile.builtFiles.join("\n")}
`;

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
  const { profile } = plugin;
  const toolchain = profile.entryModule ? shellToolchain() : undefined;

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
  if (profile.entryModule) await writeShellEntry(outDir, plugin);
  await write(".gitignore", gitignore(plugin));

  for (const file of LEGAL_FILES) {
    await copyFile(join(workspaceRoot, file), join(outDir, file));
  }
  await mkdir(dirname(join(outDir, SHELL_BUILD_SCRIPT)), { recursive: true });
  await copyFile(
    join(TEMPLATES, profile.templates.buildScript),
    join(outDir, SHELL_BUILD_SCRIPT),
  );
  if (plugin.giscus) {
    await copyFile(join(TEMPLATES, "giscus.json"), join(outDir, "giscus.json"));
  }
  await write(
    SHELL_RELEASE_WORKFLOW,
    releaseWorkflow(
      await readFile(
        join(TEMPLATES, profile.templates.releaseWorkflow),
        "utf8",
      ),
      plugin,
    ),
  );
}

export function scopeRegistryNpmrc(
  plugin: PublishedPluginName,
  registry: string,
): string {
  const scope = PUBLISHED_PLUGINS[plugin].bundlePackage.split("/")[0];
  return `${scope}:registry=${registry}\n`;
}

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
