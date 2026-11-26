import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, inject } from "vitest";

import { listObsidianWindows } from "@zotlit/scripts/obsidian-cdp";

import { HOST_VAULT } from "./container-obsidian.ts";
import { HOLD_ENV, HOLD_FILE } from "./hold-mode.ts";
import { e2eResultsDir } from "./results-dir.ts";

if (process.env[HOLD_ENV]) {
  afterEach(async ({ task }) => {
    const file = join(e2eResultsDir(), HOLD_FILE);
    const windows = await listObsidianWindows().catch(() => []);
    await writeFile(
      file,
      `${JSON.stringify(
        {
          case: task.fullName,
          state: task.result?.state ?? "unknown",
          container: hostname(),
          vaults: windows.flatMap(({ vault, kind }) =>
            vault && vault !== HOST_VAULT && kind === "main" ? [vault] : [],
          ),
          zoteroPort: inject("pairedEnvironment")?.debuggerPort ?? null,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Run held after "${task.fullName}". Delete ${file} to go on.`);
    while (existsSync(file)) await delay(500);
  }, 0);
}
