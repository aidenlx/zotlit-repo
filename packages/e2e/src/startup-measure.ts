import { randomBytes } from "node:crypto";
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import {
  acquireDesktopSlotOrExit,
  EXIT_ADMISSION_BLOCKED,
  reportDesktopProgress,
  SILENCE_LIMIT_MS,
} from "@zotlit/scripts/desktop-slot";
import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";
import { PUBLISHED_PLUGINS } from "@zotlit/scripts/shell/plugins";
import type { PublishedPlugin } from "@zotlit/scripts/shell/plugins";
import {
  pluginsOption,
  resolveVaultPlugins,
} from "@zotlit/scripts/vault-plugins";

import { cdpEval, instanceLayout, launchInstance } from "./startup-instance.ts";
import type { InstanceLayout } from "./startup-instance.ts";
import { probePluginFiles } from "./startup-probe.ts";
import type { ProbeConfig, ProbeResult } from "./startup-probe.ts";
import { splitProfile } from "./startup-profile.ts";
import type { CpuProfile, ProfileSplit } from "./startup-profile.ts";
import {
  BUSY_LOAD_LIMIT,
  busyReason,
  GATED_MODES,
  MODE_BUDGET_NAME,
  pluginStartupMs,
  STARTUP_MODES,
  startupCheck,
  summarize,
} from "./startup-record.ts";
import type {
  ModeStartup,
  StartupBudgets,
  StartupMode,
  StartupSummary,
} from "./startup-record.ts";

const PRIMING_LOADS = 2;
const SETTLE_MS = 3000;
const DEFAULT_RUNS = 5;
const SAMPLING_INTERVAL_US = 100;
const SNAPSHOT_DELAY_MS = 100;
const ZOTERO_PATHS_KEY = "zotlit-zotero-paths";

const MODE_TEXT: Record<StartupMode, string> = {
  daily: `daily: quit and launch Obsidian again with the same main.js bytes, after ${PRIMING_LOADS} priming launches, so the V8 code cache on disk applies`,
  update:
    "update: quit and launch Obsidian again with new main.js bytes each time, the first start after a plugin update",
  reload: `reload: reload the window with the same bytes, after ${PRIMING_LOADS} priming reloads; a trend, not a cold start`,
};

function renderReference(): string {
  const budgets = Object.values<PublishedPlugin>(PUBLISHED_PLUGINS).map(
    ({ app, budget }) =>
      `  ${app}: ${GATED_MODES.map((mode) => `${mode} ${budget[MODE_BUDGET_NAME[mode]] ?? "unset"}`).join(", ")}`,
  );
  return [
    "Needs desktop Obsidian 1.15.1 installed and the production builds in",
    "apps/<app>/dist (pnpm check:bundle). Takes an Exclusive Hold, and starts",
    "an Obsidian instance of its own, with its own HOME and user data folder;",
    "the Obsidian windows already open stay as they are.",
    "",
    "Each plugin is measured alone, in a vault that enables only that plugin and",
    "a probe plugin after it. Modes, in this order:",
    ...STARTUP_MODES.map((mode) => `  ${MODE_TEXT[mode]}`),
    "Each start reads communityPlugins.<id> from dev:startup and the time from",
    "layout ready until the start-up snapshot goes.",
    "",
    `Refuses with exit ${EXIT_ADMISSION_BLOCKED} while the 1-minute load average is at or above --max-load (${BUSY_LOAD_LIMIT}).`,
    "",
    "Budgets (--check, from PUBLISHED_PLUGINS budget):",
    ...budgets,
    "",
    "Output:",
    "  .scratch/startup-measure/<time>/summary.json, dev-startup.jsonl,",
    "  and with --profile, <id>.cpuprofile and profile.json",
  ].join("\n");
}

const options = await yargs(hideBin(process.argv))
  .usage(
    "measure:startup: the cold start of each plugin's production build, as Obsidian records it, on a quit and a new launch of Obsidian",
  )
  .option("plugins", pluginsOption)
  .option("runs", {
    describe: "counted starts per mode",
    type: "number",
    default: DEFAULT_RUNS,
  })
  .option("check", {
    describe: "fail when a median is above the plugin's budget for its mode",
    type: "boolean",
    default: false,
  })
  .option("profile", {
    describe:
      "after the modes, take a CPU profile of one daily start per plugin",
    type: "boolean",
    default: false,
  })
  .option("max-load", {
    describe: "refuse to measure at or above this 1-minute load average",
    type: "number",
    default: BUSY_LOAD_LIMIT,
  })
  .option("keep", {
    describe: "keep the instance folders and the Fixture after the run",
    type: "boolean",
    default: false,
  })
  .epilogue(renderReference())
  .strict()
  .version(false)
  .parse();

const log = (message: string): void => {
  console.error(message);
  reportDesktopProgress(message);
};

function refuseWhenBusy(): void {
  const reason = busyReason(loadavg()[0]!, options.maxLoad);
  if (!reason) return;
  console.error(`measure:startup: ${reason}`);
  process.exit(EXIT_ADMISSION_BLOCKED);
}

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const scratch = join(workspaceRoot, ".scratch", "startup-measure");
const plugins = await resolveVaultPlugins(workspaceRoot, options.plugins);
const budgets: StartupBudgets = Object.fromEntries(
  plugins.map(({ id, app }) => {
    const budget = Object.values<PublishedPlugin>(PUBLISHED_PLUGINS).find(
      (plugin) => plugin.app === app,
    )?.budget;
    return [
      id,
      Object.fromEntries(
        GATED_MODES.map((mode) => [mode, budget?.[MODE_BUDGET_NAME[mode]]]),
      ),
    ];
  }),
);

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
      mainJs: mainJs.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"),
    };
  }),
);
type Bundle = (typeof bundles)[number];

refuseWhenBusy();
using _desktopSlot = await acquireDesktopSlotOrExit({
  cwd: workspaceRoot,
  command: "measure:startup",
  silenceMs: SILENCE_LIMIT_MS.e2e,
  exclusive: true,
});
refuseWhenBusy();

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
const fixture = getFixtureLayout(join(outDir, "fixture"));

interface Start {
  readonly ms: number;
  readonly layoutToSnapshot?: number;
  readonly layoutToCallbacksDone?: number;
  readonly capped: boolean;
}

function readStart(id: string, mode: StartupMode, result: ProbeResult): Start {
  const ms = pluginStartupMs(result.devStartup, [id])[id]!;
  const { layoutReady, callbacksDone, snapshotGone } = result.times;
  const shown = result.times.snapshotShown && snapshotGone !== undefined;
  if (mode !== "reload" && !shown) {
    log(
      `${id} ${mode}: the start-up snapshot was not on screen at layout ready`,
    );
  }
  return {
    ms,
    layoutToSnapshot:
      shown && layoutReady !== undefined
        ? snapshotGone - layoutReady
        : undefined,
    layoutToCallbacksDone:
      layoutReady !== undefined && callbacksDone !== undefined
        ? callbacksDone - layoutReady
        : undefined,
    capped:
      shown &&
      callbacksDone !== undefined &&
      snapshotGone < callbacksDone + SNAPSHOT_DELAY_MS - 5,
  };
}

function modeStartup(starts: readonly Start[]): ModeStartup {
  const values = (pick: (start: Start) => number | undefined): number[] =>
    starts.flatMap((start) => {
      const value = pick(start);
      return value === undefined ? [] : [Math.round(value * 10) / 10];
    });
  const snapshot = values((start) => start.layoutToSnapshot);
  const callbacks = values((start) => start.layoutToCallbacksDone);
  return {
    plugin: summarize(starts.map(({ ms }) => ms)),
    layoutToSnapshot: snapshot.length ? summarize(snapshot) : undefined,
    layoutToCallbacksDone: callbacks.length ? summarize(callbacks) : undefined,
    snapshotCapped: starts.filter(({ capped }) => capped).length,
  };
}

async function setUp(
  layout: InstanceLayout,
  holdsZotLit: boolean,
): Promise<void> {
  await using instance = await launchInstance(layout, { devtools: true, log });
  using page = await instance.devtools();
  for (let tries = 0; ; tries++) {
    if (
      await cdpEval<boolean>(
        page,
        "!!window.app?.workspace?.layoutReady",
      ).catch(() => false)
    )
      break;
    if (tries > 300)
      throw new Error("the measure vault never reached layout ready");
    await delay(100);
  }
  const version = await cdpEval<string>(
    page,
    `require("@electron/remote").app.getVersion()`,
  );
  if (version !== "1.15.1") {
    throw new Error(
      `the measure instance runs Obsidian ${version}; it needs 1.15.1`,
    );
  }
  const paths = { profileDir: fixture.profileDir, dataDir: fixture.dataDir };
  const stored = await cdpEval<unknown>(
    page,
    `(() => {
      ${holdsZotLit ? `app.saveLocalStorage(${JSON.stringify(ZOTERO_PATHS_KEY)}, ${JSON.stringify(paths)});` : ""}
      localStorage.setItem("enable-plugin-" + app.appId, "true");
      return app.loadLocalStorage(${JSON.stringify(ZOTERO_PATHS_KEY)});
    })()`,
  );
  if (holdsZotLit && JSON.stringify(stored) !== JSON.stringify(paths)) {
    throw new Error(
      `the Fixture paths did not reach the measure vault: ${JSON.stringify(stored)}`,
    );
  }
  await cdpEval(
    page,
    `setTimeout(() => require("@electron/remote").app.quit(), 0), true`,
  );
  await instance.exited;
}

async function measurePlugin(bundle: Bundle): Promise<{
  modes: Partial<Record<StartupMode, ModeStartup>>;
  profile?: ProfileSplit;
}> {
  const { id } = bundle;
  const layout = instanceLayout(
    join(outDir, id),
    randomBytes(8).toString("hex"),
  );
  const pluginsDir = join(layout.vaultPath, ".obsidian", "plugins");
  const holdsZotLit = id === "zotlit";
  const report = holdsZotLit
    ? `(() => { const services = app.plugins.plugins.zotlit.services; return services.bridge.runSync(services.zoteroPref.current).databasePath; })()`
    : "";
  const probe = (role: ProbeConfig["role"]) =>
    probePluginFiles({
      role,
      resultDir: layout.resultDir,
      settleMs: SETTLE_MS,
      report,
    });
  const probes = { probe: probe("probe"), gate: probe("gate") };

  await cp(fixture.vaultDir, layout.vaultPath, { recursive: true });
  await rm(join(pluginsDir, "hot-reload"), { recursive: true, force: true });
  for (const files of Object.values(probes)) {
    await mkdir(join(pluginsDir, files.id), { recursive: true });
    await writeFile(
      join(pluginsDir, files.id, "manifest.json"),
      files.manifest,
    );
    await writeFile(join(pluginsDir, files.id, "main.js"), files.mainJs);
  }
  const pluginDir = join(pluginsDir, id);
  await mkdir(pluginDir, { recursive: true });
  for (const file of ["styles.css", "manifest.json"]) {
    await copyFile(join(bundle.dist, file), join(pluginDir, file));
  }

  const enable = async (gate: boolean) =>
    writeFile(
      join(layout.vaultPath, ".obsidian", "community-plugins.json"),
      JSON.stringify([...(gate ? [probes.gate.id] : []), id, probes.probe.id]),
    );
  const install = async (nonce?: string) => {
    await writeFile(
      join(pluginDir, "main.js"),
      nonce === undefined ? bundle.mainJs : `${bundle.mainJs}/* ${nonce} */\n`,
    );
  };
  const check = (result: ProbeResult) => {
    if (holdsZotLit && result.report !== fixture.databasePath) {
      throw new Error(
        `ZotLit read ${String(result.report)}, not the Fixture database ${fixture.databasePath}`,
      );
    }
  };
  const record = async (mode: string, result: ProbeResult) => {
    await appendFile(
      join(outDir, "dev-startup.jsonl"),
      `${JSON.stringify({ id, mode, devStartup: JSON.parse(result.devStartup), times: result.times })}\n`,
    );
  };

  await setUp(layout, holdsZotLit);
  await install();
  await enable(false);

  const launchOnce = async (
    mode: StartupMode,
    label: string,
  ): Promise<ProbeResult> => {
    await using instance = await launchInstance(layout, { log });
    const result = await instance.nextResult();
    await instance.next("quit");
    check(result);
    await record(mode, result);
    log(
      `${id} ${mode} ${label}: ${pluginStartupMs(result.devStartup, [id])[id]} ms`,
    );
    return result;
  };

  const profileOnce = async (): Promise<{
    result: ProbeResult;
    recorded: CpuProfile;
  }> => {
    await using instance = await launchInstance(layout, {
      devtools: true,
      log,
    });
    using page = await instance.devtools();
    for (let tries = 0; ; tries++) {
      if (
        await cdpEval<boolean>(
          page,
          "window.__ztStartup?.gateWaiting === true",
        ).catch(() => false)
      )
        break;
      if (tries > 3000) throw new Error("the gate plugin never started");
      await delay(10);
    }
    await page.send("Profiler.enable");
    await page.send("Profiler.setSamplingInterval", {
      interval: SAMPLING_INTERVAL_US,
    });
    await page.send("Profiler.start");
    await cdpEval(page, "window.__ztStartup.profilerReady = true");
    const result = await instance.nextResult();
    const { profile: recorded } = (await page.send(
      "Profiler.stop",
      {},
      { timeoutMs: 120_000 },
    )) as {
      profile: CpuProfile;
    };
    await instance.next("quit");
    check(result);
    await record("daily", result);
    log(
      `${id} daily profile: ${pluginStartupMs(result.devStartup, [id])[id]} ms`,
    );
    return { result, recorded };
  };

  const modes: Partial<Record<StartupMode, ModeStartup>> = {};
  for (const mode of STARTUP_MODES) {
    const starts: Start[] = [];
    if (mode === "reload") {
      await install();
      await using instance = await launchInstance(layout, { log });
      check(await instance.nextResult());
      for (let run = 1 - PRIMING_LOADS; run <= options.runs; run++) {
        await instance.next("reload");
        const result = await instance.nextResult();
        check(result);
        await record(mode, result);
        log(
          `${id} reload ${run}: ${pluginStartupMs(result.devStartup, [id])[id]} ms`,
        );
        if (run >= 1) starts.push(readStart(id, mode, result));
      }
      await instance.next("quit");
    } else {
      const prime = mode === "daily" ? PRIMING_LOADS : 0;
      for (let run = 1 - prime; run <= options.runs; run++) {
        if (mode === "update")
          await install(
            `update-${Temporal.Now.instant().epochMilliseconds}-${run}`,
          );
        const result = await launchOnce(mode, `start ${run}`);
        if (run >= 1) starts.push(readStart(id, mode, result));
      }
    }
    modes[mode] = modeStartup(starts);
  }

  let profile: ProfileSplit | undefined;
  if (options.profile) {
    await install();
    await enable(true);
    const { result, recorded } = await profileOnce();
    await writeFile(join(outDir, `${id}.cpuprofile`), JSON.stringify(recorded));
    profile = splitProfile(
      recorded,
      result.times,
      pluginStartupMs(result.devStartup, [id])[id]!,
    );
    await enable(false);
  }
  return { modes, profile };
}

const summary: StartupSummary = {};
const profiles: Record<string, ProfileSplit> = {};
const loadAtStart = loadavg()[0]!;
try {
  await buildFixture(fixture, { zoteroHttpPort: offlinePort });
  for (const bundle of bundles) {
    const measured = await measurePlugin(bundle);
    summary[bundle.id] = measured.modes;
    if (measured.profile) profiles[bundle.id] = measured.profile;
  }
} finally {
  if (!options.keep) {
    for (const { id } of bundles) {
      await rm(join(outDir, id), { recursive: true, force: true });
    }
    await discardFixture(fixture);
  }
}

await writeFile(
  join(outDir, "summary.json"),
  JSON.stringify(
    { load: { start: loadAtStart, end: loadavg()[0] }, summary },
    null,
    2,
  ),
);
if (Object.keys(profiles).length) {
  await writeFile(
    join(outDir, "profile.json"),
    JSON.stringify(profiles, null, 2),
  );
  for (const [id, split] of Object.entries(profiles)) {
    console.log(
      `${id} profile, communityPlugins ${split.pluginMs} ms, clock within ${split.clockErrorMs} ms:`,
    );
    for (const window of split.windows) {
      console.log(
        `  ${window.name}: ${window.wallMs} ms wall, ${window.busyMs} ms sampled; ${window.top.map(({ frame, ms }) => `${frame} ${ms}`).join("; ")}`,
      );
    }
  }
}
console.log(JSON.stringify(summary, null, 2));
const { lines, failures } = startupCheck(summary, budgets);
for (const line of lines) console.log(line);
console.log(
  `load average ${loadAtStart.toFixed(1)} at the start, ${loadavg()[0]!.toFixed(1)} at the end`,
);
if (options.check) {
  for (const failure of failures) console.error(`✖ ${failure}`);
  if (failures.length) process.exitCode = 1;
}
