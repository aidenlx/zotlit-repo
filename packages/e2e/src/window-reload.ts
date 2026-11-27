import { prepareRunWindow } from "./background-throttling.ts";
import { cli, obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";

function runAppReload(vaultId: string): Promise<boolean> {
  return obRun(vaultId, ({ app }) => {
    setTimeout(() => app.commands.executeCommandById("app:reload"));
    return true;
  });
}

export async function reloadWindow(
  vaultId: string,
  reload: (vaultId: string) => Promise<boolean> = runAppReload,
): Promise<void> {
  const plugins = await obRun(vaultId, async ({ app, zotlit }) => {
    if (app.plugins.plugins.zotlit)
      await zotlit.services.bridge.runPromise(zotlit.services.settings.flush);
    await app.workspace.requestSaveLayout.run();
    return JSON.parse(
      await app.vault.adapter.read(
        `${app.vault.configDir}/community-plugins.json`,
      ),
    ) as string[];
  });
  await obRun(vaultId, ({ page }) => {
    window.__ztRestoreBackgroundThrottling?.();
    page.scratch.windowBeforeReload = true;
  });
  const scheduled = await reload(vaultId);
  if (!scheduled) {
    throw new Error(
      `could not reload the window of ${vaultId}: ${String(scheduled)}`,
    );
  }
  await obRunUntil(
    vaultId,
    ({ app, page }, { plugins }) =>
      !page.scratch.windowBeforeReload &&
      app.workspace.layoutReady &&
      plugins.every((id) => {
        const plugin = app.plugins.plugins[id] as
          | (import("obsidian").Plugin & {
              _loaded: boolean;
              services?: unknown;
            })
          | undefined;
        return (
          plugin?._loaded === true &&
          (!("services" in plugin) || !!plugin.services)
        );
      }),
    { plugins },
    {
      what: `the window of ${vaultId} did not come back with ${plugins.join(", ")} loaded`,
      tries: 120,
    },
  );
  const commands = await waitFor(async () => {
    const state = await cli([`vault=${vaultId}`, "plugins:restrict"]).catch(
      () => "",
    );
    return state === "on" || state === "off";
  });
  if (!commands) {
    throw new Error(`the window of ${vaultId} never registered its commands`);
  }
  await prepareRunWindow(vaultId);
}
