import { join } from "node:path";

export const FIXTURE_PLUGIN_ID = "zotlit";

export function holdsZotLit(plugins: readonly { id: string }[]): boolean {
  return plugins.some(({ id }) => id === FIXTURE_PLUGIN_ID);
}

export interface FixtureLayout {
  root: string;
  dataDir: string;
  databasePath: string;
  linkedFilesDir: string;
  profileDir: string;
  vaultDir: string;
  pluginDir: string;
  pluginDataPath: string;
}

export function getFixtureRoot(workspaceRoot: string): string {
  return join(workspaceRoot, ".scratch", "acceptance-fixture");
}

export function getFixtureLayout(root: string): FixtureLayout {
  const dataDir = join(root, "zotero-data");
  const vaultDir = join(root, "zt-fixture-vault");
  const pluginDir = join(vaultDir, ".obsidian", "plugins", FIXTURE_PLUGIN_ID);
  return {
    root,
    dataDir,
    databasePath: join(dataDir, "zotero.sqlite"),
    linkedFilesDir: join(root, "linked-files"),
    profileDir: join(root, "zotero-profile"),
    vaultDir,
    pluginDir,
    pluginDataPath: join(pluginDir, "data.json"),
  };
}
