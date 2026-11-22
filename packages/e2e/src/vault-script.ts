import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { promisify } from "node:util";

import { getWorktreeVaultName } from "@zotlit/scripts/dev-vault";
import { resolveVaultPlugins } from "@zotlit/scripts/vault-plugins";

import { assertDevBundleFresh } from "./bundle-freshness.ts";
import { cli } from "./obsidian-cli.ts";
import { OBSIDIAN_VERSION_PAIR } from "./obsidian-version.ts";

const execFileAsync = promisify(execFile);

function scriptPath(workspaceRoot: string): string {
  return join(workspaceRoot, "packages/scripts/scripts/obsidian-vault.ts");
}

export async function isObsidianReachable(
  workspaceRoot: string,
): Promise<boolean> {
  let failure = "";
  const result = await execFileAsync(
    process.execPath,
    [scriptPath(workspaceRoot), "status"],
    { windowsHide: true },
  ).catch((error: { stderr?: string }) => {
    failure = error.stderr?.trim() ?? "";
    return undefined;
  });
  if (!result?.stdout.trim().startsWith("ready ")) {
    if (failure.includes("names a vault that is not open")) {
      throw new Error(
        `End-to-end Run cannot select its host vault.\n${failure}`,
      );
    }
    if (process.env.ZOTLIT_E2E_REQUIRED === "1") {
      throw new Error(
        `End-to-end Run requires a running desktop Obsidian with the CLI enabled. Open a host vault and check with: node packages/scripts/scripts/obsidian-cli.ts version${failure ? `\n\n${failure}` : ""}`,
      );
    }
    return false;
  }
  const version = (await cli(["version"])).trim();
  if (version !== OBSIDIAN_VERSION_PAIR) {
    throw new Error(
      `End-to-end Run requires Obsidian ${OBSIDIAN_VERSION_PAIR}; running ${version}. Install the pinned installer and app versions before running the suite.`,
    );
  }
  return true;
}

export type VaultScript = (args: string[]) => Promise<{ stdout: string }>;

export async function stableHost(): Promise<string | undefined> {
  const output = await cli([
    "eval",
    "code=JSON.stringify(require('electron').ipcRenderer.sendSync('vault-list'))",
  ]).catch(() => undefined);
  const reply = output?.slice(output.lastIndexOf("=> ") + 3);
  if (!reply) return undefined;
  const vaults = JSON.parse(reply) as Record<
    string,
    { path: string; open?: boolean }
  >;
  return Object.entries(vaults).find(
    ([, vault]) =>
      vault.open === true && !vault.path.includes(`${sep}.scratch${sep}e2e-`),
  )?.[0];
}

export function vaultScript(
  workspaceRoot: string,
  fixtureRoot: string,
): VaultScript {
  return async (args) => {
    const host = await stableHost();
    return execFileAsync(
      process.execPath,
      [
        scriptPath(workspaceRoot),
        ...args,
        `--fixture-root=${fixtureRoot}`,
        ...(process.env.ZOTLIT_RUN_CONTAINER ? [] : ["--inactive"]),
      ],
      {
        windowsHide: true,
        env: host ? { ...process.env, ZT_HOST_VAULT: host } : process.env,
      },
    );
  };
}

export function e2eVaultDir(workspaceRoot: string, name: string): string {
  return join(
    workspaceRoot,
    ".scratch",
    `e2e-${name}-${getWorktreeVaultName(workspaceRoot)}`,
  );
}

export async function clearVault(
  run: VaultScript,
  path: string,
): Promise<void> {
  await run(["remove", path]);
  await rm(path, { recursive: true, force: true });
}

async function copyDevBundles(
  workspaceRoot: string,
  vaultPath: string,
  list: string,
): Promise<string> {
  const plugins = await resolveVaultPlugins(workspaceRoot, list);
  for (const plugin of plugins) {
    await assertDevBundleFresh(workspaceRoot, plugin.app);
    const pluginDir = join(vaultPath, ".obsidian", "plugins", plugin.id);
    await mkdir(pluginDir, { recursive: true });
    await cp(plugin.devBundleDir, pluginDir, { recursive: true });
  }
  return plugins.map(({ id }) => id).join(",");
}

export async function installPlugins(
  workspaceRoot: string,
  vaultPath: string,
  list: string,
): Promise<string> {
  return `--plugins=${await copyDevBundles(workspaceRoot, vaultPath, list)}`;
}

export async function installWithoutEnabling(
  workspaceRoot: string,
  vaultPath: string,
  list: string,
): Promise<string> {
  return `--install=${await copyDevBundles(workspaceRoot, vaultPath, list)}`;
}
