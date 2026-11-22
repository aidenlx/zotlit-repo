#!/usr/bin/env node

import type { DesktopSlot } from "#desktop-slot";
import type { VaultPlugin } from "#vault-plugins";
import { access } from "node:fs/promises";
import { join } from "node:path";
import yargs from "yargs";
import type { Argv } from "yargs";
import { hideBin } from "yargs/helpers";

import {
  acquireDesktopSlotOrExit,
  describeLeaseEnd,
  EXIT_LEASE_ENDED,
  formatDuration,
  KILL_AFTER_MS,
  NOTICE_MS,
  removedLeaseFlag,
} from "#desktop-slot";
import { DEV_VAULT_CASE_ENV } from "#dev-vault";
import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  DEFAULT_STRESS_ITEM_COUNT,
  DEFAULT_VAULT_CASE,
  discardFixture,
  getFixtureLayout,
  getFixtureRoot,
  LIBRARIES,
  PERSONAL_SELECTOR,
  SCOPE_CASES,
  selectScopeCase,
  STRESS_GROUP_LIBRARY,
  STRESS_GROUP_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT,
  STRESS_LIBRARY_TIERS,
  UNAVAILABLE_GROUP_IDS,
  VAULT_CASES,
  writePairedRunState,
} from "#fixture";
import { forkFixtureData, removeFixtureFork } from "#fixture/fork";
import { renderGuide } from "#fixture/guide";
import { runPairedRun } from "#fixture/paired-run";
import {
  createNodePairedRunPorts,
  describeLive,
} from "#fixture/paired-run-node";
import {
  harvestPristineTemplate,
  PRISTINE_STYLES_PATH,
  PRISTINE_TEMPLATE_PATH,
} from "#fixture/pristine";
import { regenerateFixtureSampleItems } from "#fixture/sample-items";
import { getWorkspaceRoot } from "#package-roots";
import {
  installBetterBibtex,
  launchPairedZotero,
  PINNED_ZOTERO_VERSION,
  ZOTERO_APP_ENV,
} from "#paired-zotero";
import { pluginsOption, resolveVaultPlugins } from "#vault-plugins";

const scopeCaseIds = SCOPE_CASES.map((c) => c.id).join(", ");
const vaultCaseIds = VAULT_CASES.map((c) => c.id).join(", ");

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const layout = getFixtureLayout(getFixtureRoot(workspaceRoot));
const companionDir = join(workspaceRoot, "apps", "zotero", "dist-dev", "addon");
const pairedRunPorts = createNodePairedRunPorts({ workspaceRoot, layout });

const localApiOption = {
  describe:
    "open Zotero's Local API in the Fixture profile, on a free Zotero HTTP port the profile carries",
  type: "boolean",
  default: false,
} as const;

const grantLocalApiWritesOption = {
  describe:
    "seed a remembered Local API write grant for the Development Vault; use --no-grant-local-api-writes to test authorization",
  type: "boolean",
  default: true,
} as const;

function pairedRunBuilder(y: Argv) {
  return y
    .positional("scope-case", {
      describe: `Scope Case to build (${scopeCaseIds})`,
      type: "string",
      default: DEFAULT_SCOPE_CASE,
    })
    .option("vault-case", {
      describe: `Vault Case to build (${vaultCaseIds}); each case other than the default opens its own Development Vault (default: $${DEV_VAULT_CASE_ENV})`,
      type: "string",
      choices: VAULT_CASES.map(({ id }) => id),
      default: process.env[DEV_VAULT_CASE_ENV],
    })
    .option("purge", {
      describe:
        "restore the exact generated Development Vault seed, and clear the plugin's vault-scoped local storage and stored excerpt images",
      type: "boolean",
      default: false,
    })
    .option("local-api", localApiOption)
    .option("grant-local-api-writes", grantLocalApiWritesOption)
    .epilogue(
      `The Paired Run holds a Desktop Slot as a manual hold, with no duration, until this process exits. When a run waits for the slot, the hold gets ${formatDuration(NOTICE_MS)} of notice on stderr and then stops the Paired Run with exit ${EXIT_LEASE_ENDED}; see pnpm desktop-slot --help.`,
    );
}

async function holdDesktopSlot(mode: "open" | "dev"): Promise<DesktopSlot> {
  return await acquireDesktopSlotOrExit({
    cwd: workspaceRoot,
    command: `pnpm fixture ${mode}`,
    manual: true,
    onLeaseEnd: (owner) => {
      console.error(
        `Desktop Slot: ${describeLeaseEnd(owner, Temporal.Now.instant().epochMilliseconds)}; stopping the Paired Run (exit ${EXIT_LEASE_ENDED}).`,
      );
      process.exitCode = EXIT_LEASE_ENDED;
      if (process.listenerCount("SIGTERM") < 2) process.exit(EXIT_LEASE_ENDED);
      process.emit("SIGTERM", "SIGTERM");
      setTimeout(() => process.exit(EXIT_LEASE_ENDED), KILL_AFTER_MS).unref();
    },
  });
}

async function findPluginBundles(
  plugins: readonly VaultPlugin[],
): Promise<{ id: string; bundleDir: string }[]> {
  const bundles = [];
  for (const { id, devBundleDir } of plugins) {
    const built = await access(join(devBundleDir, "main.js")).then(
      () => true,
      () => false,
    );
    if (built) bundles.push({ id, bundleDir: devBundleDir });
  }
  return bundles;
}

function kilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`;
}

function printPaths(): void {
  console.log(`Zotero data directory   ${layout.dataDir}`);
  console.log(`Zotero profile          ${layout.profileDir}`);
  console.log(`Obsidian vault          ${layout.vaultDir}`);
}

function printLibraries(): void {
  for (const library of LIBRARIES) {
    const selector = library.groupID ?? PERSONAL_SELECTOR;
    const membership = library.editable ? "editable" : "read-only";
    console.log(
      `  ${String(selector).padEnd(10)} libraryID ${library.libraryID}  ${membership}  ${library.name ?? "My Library"}`,
    );
  }
  console.log(`  unavailable selectors: ${UNAVAILABLE_GROUP_IDS.join(", ")}`);
}

async function build({
  scopeCase,
  vaultCase = DEFAULT_VAULT_CASE,
  stressItemCount,
  stressLibraryItemCount,
  stressGroupLibraryItemCount,
  stressSparseLibraryID,
  localApi = false,
  plugins: requestedPlugins,
}: {
  scopeCase: string;
  vaultCase?: string;
  stressItemCount?: number;
  stressLibraryItemCount?: number;
  stressGroupLibraryItemCount?: number;
  stressSparseLibraryID?: number;
  localApi?: boolean;
  plugins?: readonly VaultPlugin[];
}): Promise<void> {
  const plugins =
    requestedPlugins ??
    (await resolveVaultPlugins(workspaceRoot, pluginsOption.default));
  const bundles = await findPluginBundles(plugins);
  const zoteroHttpPort = localApi
    ? await pairedRunPorts.allocateZoteroHttpPort()
    : undefined;
  await buildFixture(layout, {
    scopeCase,
    vaultCase,
    stressItemCount,
    stressLibraryItemCount,
    stressGroupLibraryItemCount,
    stressSparseLibraryID,
    plugins: bundles,
    zoteroHttpPort,
    localApi,
  });
  await installBetterBibtex(layout.profileDir);
  console.log(
    stressLibraryItemCount !== undefined
      ? `Built a Stress Build with ${stressLibraryItemCount.toLocaleString("en-US")} Items in My Library${
          stressGroupLibraryItemCount === undefined
            ? ""
            : ` and ${stressGroupLibraryItemCount.toLocaleString("en-US")} Items in ${STRESS_GROUP_LIBRARY.name}`
        } at ${layout.root}`
      : stressItemCount === undefined
        ? `Built the Fixture at ${layout.root}`
        : `Built a Stress Build with ${stressItemCount.toLocaleString("en-US")} synthetic Items at ${layout.root}`,
  );
  printPaths();
  console.log("Libraries:");
  printLibraries();
  console.log(`Saved Library Scope: ${scopeCase}`);
  console.log(`Vault Case: ${vaultCase}`);
  console.log("Installed pinned Better BibTeX in the Zotero profile.");
  if (zoteroHttpPort !== undefined) {
    console.log(
      `Opened Zotero's Local API at http://127.0.0.1:${zoteroHttpPort}/api/`,
    );
  }
  for (const { id } of bundles) {
    console.log(`Installed ${id} in the vault and enabled it.`);
  }
  for (const { id } of plugins.filter(
    (plugin) => !bundles.some((bundle) => bundle.id === plugin.id),
  )) {
    console.log(
      `No ${id} bundle found, so the vault has ${id} neither installed nor enabled. Run 'pnpm fixture' from the workspace root to build it first.`,
    );
  }
}

const removed = removedLeaseFlag(hideBin(process.argv));
if (removed) {
  console.error(`fixture: ${removed}`);
  process.exit(2);
}

const cli = yargs(hideBin(process.argv))
  .scriptName("fixture.ts")
  .command(
    ["build [scope-case]", "$0"],
    "rebuild the Fixture from the Fixture Spec",
    (y) =>
      y
        .positional("scope-case", {
          describe: `Scope Case to build (${scopeCaseIds})`,
          type: "string",
          default: DEFAULT_SCOPE_CASE,
        })
        .option("vault-case", {
          describe: `Vault Case to build (${vaultCaseIds})`,
          type: "string",
          choices: VAULT_CASES.map(({ id }) => id),
          default: DEFAULT_VAULT_CASE,
        })
        .option("local-api", localApiOption)
        .option("plugins", pluginsOption),
    async (argv) => {
      await build({
        scopeCase: argv["scope-case"],
        vaultCase: argv["vault-case"],
        localApi: argv["local-api"],
        plugins: await resolveVaultPlugins(workspaceRoot, argv.plugins),
      });
    },
  )
  .command(
    "open [scope-case]",
    "prepare and open a finite Paired Run",
    pairedRunBuilder,
    async (argv) => {
      using _slot = await holdDesktopSlot("open");
      await runPairedRun(
        {
          mode: "open",
          scopeCase: argv["scope-case"],
          vaultCase: argv["vault-case"],
          purge: argv.purge,
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
        },
        pairedRunPorts,
      );
    },
  )
  .command(
    "dev [scope-case]",
    "prepare and supervise a live Paired Run",
    pairedRunBuilder,
    async (argv) => {
      using _slot = await holdDesktopSlot("dev");
      await runPairedRun(
        {
          mode: "dev",
          scopeCase: argv["scope-case"],
          vaultCase: argv["vault-case"],
          purge: argv.purge,
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
        },
        pairedRunPorts,
      );
    },
  )
  .command(
    "stress [item-count]",
    "rebuild with an additive synthetic corpus",
    (y) =>
      y
        .positional("item-count", {
          describe: `number of synthetic Items to add across all Libraries; must be ${STRESS_ITEM_COUNT_CONSTRAINT} (default: ${DEFAULT_STRESS_ITEM_COUNT})`,
          type: "number",
        })
        .option("library-items", {
          describe: `fill My Library to exactly this many Items instead, for Item Query performance tiers (${STRESS_LIBRARY_TIERS.join(", ")}); must be ${STRESS_LIBRARY_ITEM_COUNT_CONSTRAINT}`,
          type: "number",
        })
        .option("group-library-items", {
          describe: `with --library-items, also fill the group Library ${STRESS_GROUP_LIBRARY.name} (${STRESS_GROUP_LIBRARY.groupID}) to exactly this many Items, for Item Query over two large Libraries; must be ${STRESS_GROUP_LIBRARY_ITEM_COUNT_CONSTRAINT}`,
          type: "number",
        })
        .option("sparse-library-id", {
          describe:
            "Group Library with only the first and last ten Stress Items",
          type: "number",
        })
        .conflicts("sparse-library-id", "library-items")
        .conflicts("item-count", "library-items"),
    async (argv) => {
      const stressLibraryItemCount = argv["library-items"];
      await build({
        scopeCase: DEFAULT_SCOPE_CASE,
        ...(stressLibraryItemCount === undefined
          ? { stressItemCount: argv["item-count"] ?? DEFAULT_STRESS_ITEM_COUNT }
          : { stressLibraryItemCount }),
        stressGroupLibraryItemCount: argv["group-library-items"],
        stressSparseLibraryID: argv["sparse-library-id"],
      });
    },
  )
  .command(
    "select <scope-case>",
    "re-scope the built vault",
    (y) =>
      y.positional("scope-case", {
        describe: `Scope Case to select (${scopeCaseIds})`,
        type: "string",
        demandOption: true,
      }),
    async (argv) => {
      await selectScopeCase(layout, argv["scope-case"]);
      console.log(`Saved Library Scope: ${argv["scope-case"]}`);
    },
  )
  .command(
    "fork [name]",
    "copy the built Zotero data to a writable named fork and print its absolute path",
    (y) =>
      y
        .positional("name", {
          type: "string",
          describe:
            "fork name: 1–64 letters, digits, hyphens or underscores, starting with a letter or digit",
        })
        .option("remove", {
          type: "string",
          describe:
            "remove this named fork after restoring the previous Device Override",
        })
        .conflicts("name", "remove")
        .check((argv) => {
          if (!argv.name && !argv.remove)
            throw new Error("Give a fork name or --remove <name>.");
          return true;
        }),
    async (argv) => {
      if (argv.remove !== undefined) {
        await removeFixtureFork(layout, argv.remove);
        console.log(`Removed Fixture fork: ${argv.remove}`);
      } else {
        console.log(await forkFixtureData(layout, argv.name!));
      }
    },
  )
  .command(
    "paths",
    "print the Fixture paths",
    () => {},
    () => {
      printPaths();
    },
  )
  .command(
    "zotero",
    `launch the Paired Zotero on the Fixture (set ${ZOTERO_APP_ENV} to run an application folder instead of the managed Zotero ${PINNED_ZOTERO_VERSION})`,
    () => {},
    async () => {
      const { applicationDir, pid } = await launchPairedZotero(
        layout,
        companionDir,
      );
      await writePairedRunState(layout, { pid });
      console.log(
        `Launched the Paired Zotero from ${applicationDir} (pid ${pid})`,
      );
      printPaths();
    },
  )
  .command(
    "harvest",
    `re-capture the pristine Zotero database template and CSL styles from a Zotero ${PINNED_ZOTERO_VERSION} first run`,
    () => {},
    async () => {
      const report = await harvestPristineTemplate(
        join(workspaceRoot, ".scratch", "fixture-harvest"),
      );
      console.log(`Harvested from ${report.applicationDir}`);
      console.log(
        `  userdata ${report.userdata} / compatibility ${report.compatibility}`,
      );
      console.log(
        `  ${kilobytes(report.bytes)} of database, ${kilobytes(report.compressedBytes)} committed`,
      );
      console.log(
        `  ${report.styles} CSL styles, ${kilobytes(report.stylesCompressedBytes)} committed`,
      );
      console.log(`Wrote ${PRISTINE_TEMPLATE_PATH}`);
      console.log(`Wrote ${PRISTINE_STYLES_PATH}`);
    },
  )
  .command(
    "samples",
    "regenerate the Workbench Sample Items",
    () => {},
    async () => {
      const generated = await regenerateFixtureSampleItems(workspaceRoot);
      console.log(
        `Regenerated ${generated.length} Sample Items in packages/notes/src/core/template-preview/samples.`,
      );
    },
  )
  .command(
    "stop",
    "close the Paired Zotero that holds this Fixture, and wait until it releases the database",
    () => {},
    async () => {
      const closed = await pairedRunPorts.stopLivePairedZotero();
      console.log(
        closed.length === 0
          ? "No Paired Zotero holds this Fixture."
          : `Closed the Paired Zotero: ${describeLive(closed)}`,
      );
    },
  )
  .command(
    "discard",
    "close the Paired Zotero that holds this Fixture, then delete the whole Fixture",
    () => {},
    async () => {
      await pairedRunPorts.stopLivePairedZotero();
      await discardFixture(layout);
      console.log(`Deleted ${layout.root}`);
    },
  )
  .epilogue(renderGuide())
  .demandCommand(0, 1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `fixture: ${error instanceof Error ? error.message : (message ?? String(error))}`,
    );
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(message));
  });

try {
  await cli.parseAsync();
} catch {
  // The fail handler above already reported the error and set the exit
  // code; this only stops the throw (sync or async) from surfacing as an
  // unhandled/uncaught error.
}
