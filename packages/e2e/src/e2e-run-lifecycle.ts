import { afterAll, afterEach, beforeAll } from "vitest";

import { prepareRunWindow } from "./background-throttling.ts";
import { expectNothingLeftOpen } from "./case-leftovers.ts";
import {
  e2eVaultPath,
  runVaultScript,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { availableLoopbackPort } from "./e2e-run-helpers.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { clearVault, installPlugins } from "./vault-script.ts";

/** Shared End-to-end Run vault state for every area file. */
export const run = {
  vaultId: "",
  m: undefined as unknown as typeof import("@zotlit/plugin-messages/messages.ts"),
  booksNotePath: "",
};

let initPromise: Promise<void> | null = null;
let refCount = 0;

async function bootstrap(): Promise<void> {
  run.m = await import("@zotlit/plugin-messages/messages.ts");
  await clearVault(runVaultScript, e2eVaultPath);
  const plugins = await installPlugins(workspaceRoot, e2eVaultPath, "zotlit");
  const created = await runVaultScript(["open", e2eVaultPath, plugins]);
  run.vaultId = created.stdout.trim().split("\n")[0]!.trim();
  await obRun(
    run.vaultId,
    async ({ app }) => {
      app.vault.setConfig("nativeMenus", false);
      // Customize opens the Template Workbench in Obsidian, as on a device
      // that remembered "Edit here in Obsidian". A build with the web
      // Workbench asks for the destination first; its cases choose one.
      app.saveLocalStorage("zotlit-profile-customization", "native");
    },
    undefined,
  );
  await prepareRunWindow(run.vaultId);
  const serverPort = await availableLoopbackPort();
  await obRun(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      zotlit.services.bridge.runSync(
        zotlit.services.settings.update({
          "server.enabled": false,
          "server.port": serverPort,
        }),
      );
    },
    { serverPort },
  );
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      return (
        !zotlit.services.bridge.runSync(
          zotlit.services.localServer.available,
        ) &&
        zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "server.port"
        ] === serverPort
      );
    },
    { serverPort },
    {
      what: "the local server to stop and the server port setting to match serverPort",
    },
  );
  await obRun(
    run.vaultId,
    async ({ zotlit }) => {
      zotlit.services.bridge.runSync(
        zotlit.services.settings.update({ "server.enabled": true }),
      );
    },
    undefined,
  );
  await obRunUntil(
    run.vaultId,
    async ({ zotlit }, { serverPort }) => {
      return (
        zotlit.services.bridge.runSync(zotlit.services.localServer.available) &&
        zotlit.services.bridge.runSync(zotlit.services.settings.current)[
          "server.port"
        ] === serverPort
      );
    },
    { serverPort },
    {
      what: "the local server to start and the server port setting to match serverPort",
    },
  );
}

async function teardown(): Promise<void> {
  try {
    await runVaultScript(["remove", e2eVaultPath, "--purge"]);
  } catch (error) {
    console.warn(
      `obsidian-vault remove --purge failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** One vault per run: area files share bootstrap and teardown. */
export function registerEndToEndRunHooks(): void {
  beforeAll(async () => {
    refCount++;
    if (!initPromise) initPromise = bootstrap();
    await initPromise;
  }, 180000);

  afterAll(async () => {
    refCount--;
    if (refCount === 0 && initPromise) {
      await teardown();
      initPromise = null;
    }
  }, 120000);

  afterEach(() => expectNothingLeftOpen(run.vaultId));
}
