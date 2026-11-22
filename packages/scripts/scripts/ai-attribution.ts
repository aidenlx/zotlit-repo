#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { attributionLines } from "#ai-attribution";

async function checkMessage(file: string): Promise<string[]> {
  const lines = attributionLines(await readFile(file, "utf8"));
  return lines.length
    ? ["Commit message credits an AI agent:", ...lines.map((l) => `  ${l}`)]
    : [];
}

const [mode, arg = ""] = process.argv.slice(2);
const problems =
  mode === "message" ? await checkMessage(arg) : [`Unknown mode: ${mode}`];

if (problems.length) {
  console.error(`\n${problems.join("\n")}\n`);
  console.error("Remove the attribution lines and commit again.");
  process.exitCode = 1;
}
