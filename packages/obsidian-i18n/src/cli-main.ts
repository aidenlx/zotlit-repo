#!/usr/bin/env node

import { runCli } from "./cli.ts";

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

runCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${toError(error).message}\n`);
  process.exitCode = 1;
});
