#!/usr/bin/env node

import { extractAll, extractFile, listPackage } from "@electron/asar";
import { format } from "oxfmt";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

function locationHints() {
  return [
    "Runtime archives contain app.js. The sibling `app.asar` is only the launcher (skip it).",
    "",
    "Auto-updated, newest, per-user:",
    "  macOS   ~/Library/Application Support/obsidian/obsidian-<version>.asar",
    "  Linux   ~/.config/obsidian/obsidian-<version>.asar",
    "  Windows %APPDATA%\\obsidian\\obsidian-<version>.asar",
    "",
    "Bundled with the installed app (installer version, read from its package.json):",
    "  macOS         /Applications/Obsidian.app/Contents/Resources/obsidian.asar",
    "  Windows/Linux <install dir>/resources/obsidian.asar",
    "",
    "GitHub releases (obsidianmd/obsidian-releases) carry `obsidian-<version>.asar.gz`:",
    "  gh release download v<version> --repo obsidianmd/obsidian-releases --pattern '*.asar.gz'",
    "  gunzip obsidian-<version>.asar.gz",
  ].join("\n");
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    asar: { type: "string" },
    out: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

if (!values.asar) {
  console.error("error: --asar <path> is required.\n");
  console.error(locationHints());
  process.exit(1);
}

const archive = resolve(values.asar);
if (!existsSync(archive)) fail(`asar not found: ${archive}`);

let entries;
try {
  entries = listPackage(archive);
} catch (cause) {
  fail(`not a readable asar archive: ${archive}\n  ${cause.message}`);
}
if (!entries.includes("/app.js")) {
  fail(
    `${archive} has no app.js — this looks like the launcher app.asar, not the runtime.\n\n` +
      locationHints(),
  );
}

let version;
try {
  version = JSON.parse(extractFile(archive, "package.json").toString("utf8")).version;
} catch {
}
if (!version) fail("could not read version from the archive's package.json");

const defaultOutDir = join(process.cwd(), "node_modules", `.ob-rev-${version}`);
const outDir = values.out ? resolve(values.out) : defaultOutDir;
const markerPath = join(outDir, ".obsidian-asar-extract.json");

if (existsSync(outDir)) {
  const outputEntries = readdirSync(outDir);
  const ownsOutput =
    outDir === defaultOutDir || lstatSync(markerPath, { throwIfNoEntry: false })?.isFile();
  if (!ownsOutput && outputEntries.length > 0) {
    fail(
      `refusing to use ${outDir}: nonempty directory without an extraction marker. Choose an empty output directory.`,
    );
  }
  if (ownsOutput && !values.force && existsSync(join(outDir, "app.js"))) {
    console.error(`already extracted (use --force to redo): ${outDir}`);
    console.log(outDir);
    process.exit(0);
  }
  rmSync(outDir, { recursive: true, force: true });
}
console.error(`extracting ${archive}\n       to ${outDir}`);
extractAll(archive, outDir);

const topLevelJs = readdirSync(outDir, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".js"))
  .map((e) => e.name);

for (const name of topLevelJs) {
  const file = join(outDir, name);
  const source = readFileSync(file, "utf8");
  try {
    const { code, errors } = await format(name, source, { semi: true });
    if (errors.length) {
      console.error(`  skip ${name}: ${errors.length} parse error(s), keeping raw`);
      continue;
    }
    writeFileSync(file, code);
    console.error(`  fmt  ${name}`);
  } catch (cause) {
    console.error(`  skip ${name}: ${cause.message}, keeping raw`);
  }
}

writeFileSync(markerPath, `${JSON.stringify({ archive, version })}\n`);
console.error(`done. obsidian ${version} source ready.`);
console.log(outDir);
