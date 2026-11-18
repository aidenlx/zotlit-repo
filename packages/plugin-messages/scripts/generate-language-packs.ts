#!/usr/bin/env node
// Compiles the plugin's Message facade and Language Packs into generated/,
// for `mise run init`, the Turbo tasks that read them and the release
// workflow, under the same prefix rules the plugin's Vite build applies.

import { resolve } from "node:path";

import { compile } from "@zotlit/obsidian-i18n/compiler";

import {
  EXCLUDE_MESSAGE_PREFIXES,
  INCLUDE_MESSAGES,
  SCOPED_MESSAGE_MODULES,
  TARGET_LOCALE_MESSAGE_PREFIXES,
} from "./language-pack-options.ts";

const packageRoot = resolve(import.meta.dirname, "..");

const result = await compile({
  root: packageRoot,
  project: "../../project.inlang",
  output: "generated",
  excludeMessagePrefixes: EXCLUDE_MESSAGE_PREFIXES,
  includeMessages: INCLUDE_MESSAGES,
  scopedMessageModules: SCOPED_MESSAGE_MODULES,
  targetLocaleMessagePrefixes: TARGET_LOCALE_MESSAGE_PREFIXES,
});
process.stdout.write(`Generated ${result.messageCount} Message wrappers\n`);
if (result.warnings.length > 0) {
  process.stderr.write(`${result.warnings.join("\n")}\n`);
}
