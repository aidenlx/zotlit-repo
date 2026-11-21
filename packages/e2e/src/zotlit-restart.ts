// The first half of a restart of ZotLit in an open vault: a case writes what
// the next start reads, then turns ZotLit on itself.
import { obRun } from "./obsidian-cli.ts";

/**
 * Turns ZotLit off in the open vault, and waits until its services closed and
 * it holds no binding of a PDF tab.
 */
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
