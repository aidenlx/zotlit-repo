import { obRun, obRunUntil } from "./obsidian-cli.ts";

export async function useListingProfile(
  vaultId: string,
  { restore = false }: { restore?: boolean } = {},
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { restore }) => {
      const { bridge, profile } = zotlit.services;
      if (restore) await bridge.runPromise(profile.restoreDefault);
      const listed = page.listAnnotations(
        bridge.runSync(profile.getBuiltInSource),
      );
      const path = bridge.runSync(profile.defaultDocumentPath);
      const folder = path.slice(0, path.lastIndexOf("/"));
      if (folder && !app.vault.getFolderByPath(folder))
        await app.vault.createFolder(folder);
      await app.vault.create(path, listed);
    },
    { restore },
  );
  await obRunUntil(
    vaultId,
    ({ zotlit }) =>
      !!zotlit.services.bridge.runSync(
        zotlit.services.profile.resolveProfile("default"),
      )?.document,
    undefined,
    { what: "The default Profile did not read its document" },
  );
}
