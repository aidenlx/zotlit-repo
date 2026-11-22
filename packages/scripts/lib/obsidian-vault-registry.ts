import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface VaultEntry {
  path: string;
  ts: number;
  open?: boolean;
}

export function findVaultId(
  vaults: Record<string, VaultEntry>,
  abs: string,
): string | undefined {
  return Object.keys(vaults).find((id) => resolve(vaults[id]!.path) === abs);
}

export async function unregisterVaultFile(
  userData: string,
  abs: string,
): Promise<string | undefined> {
  const configPath = join(userData, "obsidian.json");

  const raw = await readFile(configPath, "utf-8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (raw === undefined) return undefined;

  let config: { vaults?: Record<string, VaultEntry> };
  try {
    config = JSON.parse(raw) as typeof config;
  } catch {
    throw new Error(
      `${configPath} holds invalid JSON — refusing to rewrite it`,
    );
  }

  const vaults = config.vaults ?? {};
  const id = findVaultId(vaults, abs);
  if (!id) return undefined;

  delete vaults[id];
  config.vaults = vaults;
  const staging = `${configPath}.zt-tmp`;
  await writeFile(staging, JSON.stringify(config));
  await rename(staging, configPath);

  await rm(join(userData, `${id}.json`), { force: true });
  await rm(join(userData, "Partitions", `vault-${id}`), {
    recursive: true,
    force: true,
  });
  return id;
}
