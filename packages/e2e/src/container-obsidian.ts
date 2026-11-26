import { execFile, spawn } from "node:child_process";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  DEFAULT_CDP_PORT,
  openCdpSession,
  listObsidianWindows,
} from "@zotlit/scripts/obsidian-cdp";
import {
  createObsidianCall,
  obsidianCliSocketPath,
} from "@zotlit/scripts/obsidian-cli";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { OBSIDIAN_VERSION, OBSIDIAN_VERSION_PAIR } from "./obsidian-version.ts";
import { e2eResultsDir } from "./results-dir.ts";

const execFileAsync = promisify(execFile);
export const HOST_VAULT = "0123456789abcdef";

export default async function setup() {
  if (!process.env.ZOTLIT_RUN_CONTAINER)
    throw new Error(
      "The End-to-end Run runs in its Run Container. Start it from the repo root with `pnpm e2e`.",
    );
  if (process.env.ZOTLIT_E2E_OBSIDIAN_READY) return;
  const root = await getWorkspaceRoot(import.meta.dirname);
  const profile = join(process.env.XDG_CONFIG_HOME!, "obsidian");
  const vault = join(profile, "bootstrap-vault");
  const log = join(e2eResultsDir(), "obsidian.log");
  const call = createObsidianCall({
    socketPath: obsidianCliSocketPath(),
    timeoutMs: 1_000,
  });

  try {
    await mkdir(join(vault, ".obsidian"), { recursive: true });
    await writeFile(
      join(profile, "obsidian.json"),
      JSON.stringify({
        cli: true,
        frame: "native",
        updateDisabled: true,
        vaults: { [HOST_VAULT]: { path: vault, ts: 0, open: true } },
      }),
    );
    await using output = await open(log, "w");
    const child = spawn(
      "/opt/obsidian/obsidian",
      [
        `--user-data-dir=${profile}`,
        "--no-sandbox",
        `--remote-debugging-port=${DEFAULT_CDP_PORT}`,
      ],
      { stdio: ["ignore", output.fd, output.fd] },
    );
    let launchError: Error | undefined;
    child.on("error", (error) => {
      launchError = error;
    });
    child.unref();

    const deadline = performance.now() + 30_000;
    let version: string | undefined;
    while (performance.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Obsidian exited (${child.exitCode ?? child.signalCode})`,
        );
      }
      version = await call(["version"]).catch(() => undefined);
      if (version && !version.startsWith("Error:")) break;
      await delay(250);
    }
    if (version !== OBSIDIAN_VERSION_PAIR) {
      throw new Error(
        `Expected Obsidian ${OBSIDIAN_VERSION_PAIR}; got ${version ?? "no CLI reply"}`,
      );
    }

    await call([
      `vault=${HOST_VAULT}`,
      "eval",
      `code=localStorage.setItem("most-recently-installed-version", ${JSON.stringify(OBSIDIAN_VERSION)});localStorage.setItem("enable-plugin-${HOST_VAULT}", "true");true`,
    ]);
    await checkPaint(root);
    process.env.ZOTLIT_E2E_OBSIDIAN_READY = "1";
  } catch (cause) {
    throw new Error(`Obsidian setup failed. See ${log}`, { cause });
  }
}

async function checkPaint(root: string): Promise<void> {
  const window = (await listObsidianWindows(DEFAULT_CDP_PORT)).find(
    (candidate) => candidate.vault === HOST_VAULT,
  );
  if (!window)
    throw new Error("Obsidian CDP could not find the bootstrap vault");
  using cdp = await openCdpSession(window.webSocketDebuggerUrl);
  await cdp.send("Runtime.evaluate", {
    expression: `document.body.insertAdjacentHTML("beforeend", '<div id="run-container-paint" style="position:fixed;inset:0 auto auto 0;width:20px;height:20px;background:rgb(34, 85, 136);z-index:2147483647"></div>')`,
  });
  const { stdout } = await execFileAsync(process.execPath, [
    join(root, "packages/scripts/scripts/obsidian-cli.ts"),
    "--shot",
    join(e2eResultsDir(), "display.png"),
    "--selector",
    "#run-container-paint",
    "--sample",
    "10,10",
    `vault=${HOST_VAULT}`,
  ]);
  if (!stdout.includes("rgb(34, 85, 136)")) {
    throw new Error(
      `The window did not paint the expected color: ${stdout.trim()}`,
    );
  }
  await cdp.send("Runtime.evaluate", {
    expression: 'document.getElementById("run-container-paint").remove()',
  });
}
