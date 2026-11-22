import { join } from "node:path";

import { reportDesktopProgress } from "@zotlit/scripts/desktop-slot";
import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
import type { FixtureLayout } from "@zotlit/scripts/fixture";
import { createNodePairedRunPorts } from "@zotlit/scripts/fixture/paired-run-node";

import { waitForBetterBibtex, zoteroFetch } from "./paired-zotero.ts";
import { clearVault, e2eVaultDir, vaultScript } from "./vault-script.ts";

export interface PairedEnvironment extends AsyncDisposable {
  layout: FixtureLayout;
  vaultPath: string;
  vaultId: string;
  baseUrl: string;
  debuggerPort: number;
}

export interface PairedEnvironmentOptions {
  name?: string;
  vaultCase?: string;
}

export async function openPairedEnvironment(
  workspaceRoot: string,
  { name = "paired", vaultCase }: PairedEnvironmentOptions = {},
): Promise<PairedEnvironment> {
  const layout = getFixtureLayout(
    join(workspaceRoot, ".scratch", `e2e-${name}-fixture`),
  );
  const vaultPath = e2eVaultDir(workspaceRoot, `${name}-vault`);
  const run = vaultScript(workspaceRoot, layout.root);
  const ports = createNodePairedRunPorts({ workspaceRoot, layout });
  const removeVault = () => clearVault(run, vaultPath);

  reportDesktopProgress("Paired Run: clearing the last run");
  await ports.stopLivePairedZotero();
  await removeVault();

  await using stack = new AsyncDisposableStack();
  stack.defer(() => discardFixture(layout));
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const zoteroHttpPort = await ports.allocateZoteroHttpPort();
  stack.defer(removeVault);
  reportDesktopProgress(
    "Paired Run: building the Fixture and opening the vault",
  );
  const opened = await run([
    "open",
    vaultPath,
    "--plugins=zotlit-reader,zotlit",
    "--local-api",
    ...(vaultCase ? ["--vault-case", vaultCase] : []),
    `--live-update-port=${liveUpdatePort}`,
    `--zotero-http-port=${zoteroHttpPort}`,
  ]);
  const vaultId = opened.stdout.trim().split("\n").at(-1)?.trim();
  if (!vaultId) throw new Error(`no vault id for ${vaultPath}`);

  stack.defer(async () => {
    await ports.stopLivePairedZotero();
  });
  reportDesktopProgress("Paired Run: starting Paired Zotero");
  const { debuggerPort } = await ports.openPairedZotero();
  if (debuggerPort === undefined)
    throw new Error("Paired Zotero reported no debugging port");
  const baseUrl = `http://127.0.0.1:${zoteroHttpPort}/api/`;
  const reply = await zoteroFetch(baseUrl, "");
  if (reply.status !== 200)
    throw new Error(`Paired Zotero answered ${reply.status} at ${baseUrl}`);
  reportDesktopProgress("Paired Run: waiting for Better BibTeX");
  await waitForBetterBibtex(baseUrl);
  reportDesktopProgress("Paired Run: ready");

  const owned = stack.move();
  return {
    layout,
    vaultPath,
    vaultId,
    baseUrl,
    debuggerPort,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
