#!/usr/bin/env node

import { extractFile } from "@electron/asar";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { asar: { type: "string" } } });

if (!values.asar) {
  console.error("usage: probe-version.mjs --asar <path-to-archive>");
  process.exit(1);
}

const archive = resolve(values.asar);
if (!existsSync(archive)) {
  console.error(`error: asar not found: ${archive}`);
  process.exit(1);
}

let version;
try {
  version = JSON.parse(extractFile(archive, "package.json").toString("utf8")).version;
} catch (cause) {
  console.error(`error: could not read package.json from ${archive}: ${cause.message}`);
  process.exit(1);
}
if (!version) {
  console.error(`error: no version field in ${archive}'s package.json`);
  process.exit(1);
}

console.log(version);
