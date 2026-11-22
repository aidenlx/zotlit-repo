import { obRun } from "./obsidian-cli.ts";

export async function turnZotlitOff(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, zotlit }) => {
      const oldServices = zotlit.services;
      await app.plugins.disablePlugin("zotlit");
      const stillOpen = () =>
        !oldServices.bridge.closed() ||
        oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings)
          .length > 0;
      for (let i = 0; i < 200 && stillOpen(); i++)
        await new Promise((r) => setTimeout(r, 25));
      if (stillOpen()) throw new Error("The ZotLit services did not close");
    },
    undefined,
    { timeoutMs: 60_000 },
  );
}
