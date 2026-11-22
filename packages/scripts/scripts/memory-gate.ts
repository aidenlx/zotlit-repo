#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:os";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  ADMISSION_DEADLINE_MS,
  DESKTOP_DIR_ENV,
  DESKTOP_WAIT_ENV,
  desktopStateDir,
  EXIT_ADMISSION_BLOCKED,
  MEMORY_GATE_ADMITTED_ENV,
  MEMORY_GATE_ENV,
} from "@zotlit/config/memory-gate";

import { admitMemoryRun } from "#memory-admission";

const EXIT_USAGE = 2;

const epilogue = `The Memory Gate admits a heavy run in arrival order while the OS reports memory to spare. Under memory pressure a run waits while another admitted run is still running, and starts with a warning when none is.

Exit codes:
  ${EXIT_ADMISSION_BLOCKED}   the Admission Deadline passed with the gate still closed; blocked, not a failure.
  ${EXIT_USAGE}    usage error, such as a missing command.
  otherwise the command's code, or 128 plus the signal number.

Environment:
${[
  [`${MEMORY_GATE_ENV}=off`, "skip the gate"],
  [MEMORY_GATE_ADMITTED_ENV, "set on the command; a gate nested in it skips"],
  [
    DESKTOP_WAIT_ENV,
    `the Admission Deadline (default ${ADMISSION_DEADLINE_MS / 60_000} min)`,
  ],
  [DESKTOP_DIR_ENV, `the state directory (now ${desktopStateDir()})`],
]
  .map(([name, meaning]) => `  ${name!.padEnd(30)}${meaning}`)
  .join("\n")}`;

function usage(message: string): never {
  console.error(`memory-gate: ${message}`);
  process.exit(EXIT_USAGE);
}

const argv = await yargs(hideBin(process.argv))
  .scriptName("memory-gate")
  .usage("node packages/scripts/scripts/memory-gate.ts -- <command> [args...]")
  .parserConfiguration({ "populate--": true })
  .epilogue(epilogue)
  .strict()
  .version(false)
  .wrap(null)
  .fail((message, error) => {
    if (error) throw error;
    usage(message);
  })
  .parseAsync();
const [command, ...args] = ((argv["--"] as unknown[] | undefined) ?? []).map(
  String,
);
if (!command) usage("name the command after: -- <command> [args...]");

const admitted = await admitMemoryRun();
const options = {
  stdio: "inherit",
  env: admitted
    ? { ...process.env, [MEMORY_GATE_ADMITTED_ENV]: "1" }
    : process.env,
} as const;
const child =
  process.platform === "win32"
    ? spawn([command, ...args].join(" "), { ...options, shell: true })
    : spawn(command, args, options);
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
process.on("SIGINT", () => {});
child.on("error", (error) => {
  console.error(error.message);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0));
});
