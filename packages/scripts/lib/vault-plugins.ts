import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FIXTURE_PLUGIN_ID } from "#fixture/layout";
import { parseManifest } from "#obsidian-manifest";
import { PUBLISHED_PLUGINS } from "#shell/plugins";

export interface VaultPlugin {
  readonly id: string;
  readonly app: string;
  readonly devBundleDir: string;
}

export const pluginsOption = {
  describe: "plugins to install and enable, comma-separated, in start-up order",
  type: "string",
  default: `zotlit-reader,${FIXTURE_PLUGIN_ID}`,
} as const;

export const installOption = {
  describe:
    "plugins to install without enabling, comma-separated (the Resource Pack: zotlit-resources)",
  type: "string",
  default: "",
} as const;

export async function resolveVaultPlugins(
  workspaceRoot: string,
  list: string,
): Promise<VaultPlugin[]> {
  const registry = await Promise.all(
    Object.values(PUBLISHED_PLUGINS).map(async ({ app }) => {
      const packageJson: unknown = JSON.parse(
        await readFile(join(workspaceRoot, app, "package.json"), "utf-8"),
      );
      return {
        id: parseManifest(packageJson).id,
        app,
        devBundleDir: join(workspaceRoot, app, "dist-dev"),
      };
    }),
  );
  return list
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "")
    .map((id) => {
      const plugin = registry.find((entry) => entry.id === id);
      if (!plugin) {
        throw new Error(
          `unknown plugin "${id}"; choose from ${registry.map((entry) => entry.id).join(", ")}`,
        );
      }
      return plugin;
    });
}
