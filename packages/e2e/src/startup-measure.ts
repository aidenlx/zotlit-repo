import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  acquireDesktopSlotOrExit,
  reportDesktopProgress,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { PUBLISHED_PLUGINS } from "@zotlit/scripts/shell/plugins";
import type { PublishedPlugin } from "@zotlit/scripts/shell/plugins";
import {
  pluginsOption,
  resolveVaultPlugins,
} from "@zotlit/scripts/vault-plugins";

import { prepareRunWindow } from "./background-throttling.ts";
import { cli, obRun, obRunUntil } from "./obsidian-cli.ts";
import { pluginStartupMs, startupCheck, summarize } from "./startup-record.ts";
import type { StartupMode, StartupSummary } from "./startup-record.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const WARM_PRIMING_LOADS = 2;
const SETTLE_MS = 3000;

const options = await yargs(hideBin(process.argv))
  .usage(
    "measure:startup: the cold and warm start-up of each plugin's production build, from `dev:startup` after fresh window loads",
  )
  .option("plugins", pluginsOption)
  .option("runs", {
    describe: "counted window loads per mode",
    type: "number",
    default: 5,
  })
  .option("check", {
    describe: "fail when a warm median is above its plugin's startupWarmMs",
    type: "boolean",
    default: false,
  })
  .option("keep", {
    describe: "keep the vault and the Fixture after the run",
    type: "boolean",
    default: false,
  })
  .strict()
  .version(false)
  .parse();

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const scratch = join(workspaceRoot, ".scratch", "startup-measure");
const fixture = getFixtureLayout(join(scratch, "fixture"));
const vaultPath = e2eVaultDir(workspaceRoot, "startup-measure");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const plugins = await resolveVaultPlugins(workspaceRoot, options.plugins);
const ids = plugins.map(({ id }) => id);
const budgets = Object.fromEntries(
  plugins.map(({ id, app }) => [
    id,
    Object.values<PublishedPlugin>(PUBLISHED_PLUGINS).find(
      (plugin) => plugin.app === app,
    )?.budget.startupWarmMs,
  ]),
);

const log = (message: string): void => {
  console.error(message);
  reportDesktopProgress(message);
};

const bundles = await Promise.all(
  plugins.map(async ({ id, app }) => {
    const dist = join(workspaceRoot, app, "dist");
    const mainJs = await readFile(join(dist, "main.js"), "utf8").catch(() => {
      throw new Error(
        `${app}/dist/main.js is missing: run \`pnpm check:bundle\` for the production builds first`,
      );
    });
    return {
      id,
      dist,
      dir: join(vaultPath, ".obsidian", "plugins", id),
      mainJs: mainJs.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"),
    };
  }),
);

if (!(await isObsidianReachable(workspaceRoot))) {
  log(
    "No desktop Obsidian answers the CLI. Start Obsidian with the command line interface enabled, then run the script again. Nothing was measured.",
  );
  process.exit(1);
}
using _desktopSlot = await acquireDesktopSlotOrExit({
  cwd: workspaceRoot,
  command: "measure:startup",
  silenceMs: SILENCE_LIMIT_MS.e2e,
  exclusive: true,
});

await using offlineZotero = createServer((socket) => socket.destroy());
await new Promise<void>((resolve, reject) => {
  offlineZotero.once("error", reject);
  offlineZotero.listen(0, "127.0.0.1", resolve);
});
const offlinePort = (offlineZotero.address() as AddressInfo).port;

const outDir = join(
  scratch,
  Temporal.Now.instant().toString().replaceAll(":", "-").slice(0, 19),
);
await mkdir(outDir, { recursive: true });

let vaultId = "";

async function install(nonce: string): Promise<void> {
  for (const { dir, dist, mainJs } of bundles) {
    await rm(join(dir, ".hotreload"), { force: true });
    await rm(join(dir, "main.js.map"), { force: true });
    await writeFile(join(dir, "main.js"), `${mainJs}/* ${nonce} */\n`);
    for (const file of ["styles.css", "manifest.json"]) {
      await copyFile(join(dist, file), join(dir, file));
    }
  }
  await writeFile(
    join(vaultPath, ".obsidian", "community-plugins.json"),
    JSON.stringify(ids),
  );
}

async function loadWindow(): Promise<Record<string, number>> {
  await obRun(vaultId, () => {
    setTimeout(() => location.reload(), 50);
  });
  await delay(1500);
  await obRunUntil(
    vaultId,
    ({ app }, { ids }) =>
      app.workspace.layoutReady &&
      ids.every((id) => app.plugins.plugins[id] !== undefined),
    { ids },
    { what: "the reloaded window to load every plugin", tries: 240 },
  );
  await delay(SETTLE_MS);
  const capture = await cli([`vault=${vaultId}`, "dev:startup", "format=json"]);
  await appendFile(
    join(outDir, "dev-startup.jsonl"),
    `${capture.replaceAll("\n", "")}\n`,
  );
  return pluginStartupMs(capture, ids);
}

async function measure(mode: StartupMode): Promise<Record<string, number[]>> {
  const runs: Record<string, number[]> = Object.fromEntries(
    ids.map((id) => [id, []]),
  );
  const warmNonce = `warm-${Temporal.Now.instant().epochMilliseconds}`;
  const prime = mode === "warm" ? WARM_PRIMING_LOADS : 0;
  for (let run = 1 - prime; run <= options.runs; run++) {
    await install(
      mode === "warm"
        ? warmNonce
        : `cold-${Temporal.Now.instant().epochMilliseconds}-${run}`,
    );
    await delay(500);
    const loaded = await loadWindow();
    log(`${mode} load ${run}: ${JSON.stringify(loaded)}`);
    if (run < 1) continue;
    for (const id of ids) runs[id]!.push(loaded[id]!);
  }
  return runs;
}

const summary: StartupSummary = Object.fromEntries(ids.map((id) => [id, {}]));
try {
  await clearVault(runVaultScript, vaultPath);
  for (const { dir } of bundles) await mkdir(dir, { recursive: true });
  await install("seed");
  const created = await runVaultScript([
    "open",
    vaultPath,
    `--plugins=${ids.join(",")}`,
    `--zotero-http-port=${offlinePort}`,
  ]);
  vaultId = created.stdout.trim().split("\n")[0]!.trim();
  await prepareRunWindow(vaultId);
  for (const mode of ["cold", "warm"] as const) {
    const runs = await measure(mode);
    for (const id of ids) summary[id]![mode] = summarize(runs[id]!);
  }
} finally {
  if (!options.keep) {
    await runVaultScript(["remove", vaultPath, "--purge"]).catch(
      (error: unknown) => log(`could not remove the vault: ${String(error)}`),
    );
    await discardFixture(fixture);
  }
}

await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
const { lines, failures } = startupCheck(summary, budgets);
for (const line of lines) console.log(line);
if (options.check) {
  for (const failure of failures) console.error(`✖ ${failure}`);
  if (failures.length) process.exitCode = 1;
}
