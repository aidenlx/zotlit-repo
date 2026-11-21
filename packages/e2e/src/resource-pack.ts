// Host-side steps of the Resource Pack cases: the pack of the run vault that
// a case takes away or replaces, and the settings row of a Managed Binary.
import {
  PACK_NOTICE_KEY,
  RESOURCE_PACK_ID,
} from "@zotlit/plugin-services/core/managed-binary/resource-pack.ts";

import { obRun, obRunUntil } from "./obsidian-cli.ts";

/**
 * Keeps the installed pack of the run vault for {@link restoreRunPack}: its
 * manifest, and its file when the case writes another file in its place. The
 * vault starts with no record of a pack notice.
 */
export async function keepRunPack(
  vaultId: string,
  { file }: { file: boolean },
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { packId, noticeKey, keepFile }) => {
      const manifest = app.plugins.manifests[packId]!;
      page.scratch.zotlitE2EPackManifest = manifest;
      if (keepFile)
        page.scratch.zotlitE2EPackFile = await app.vault.adapter.readBinary(
          `${manifest.dir!}/main.js`,
        );
      app.saveLocalStorage(noticeKey, null);
    },
    { packId: RESOURCE_PACK_ID, noticeKey: PACK_NOTICE_KEY, keepFile: file },
    { timeoutMs: 60_000 },
  );
}

/**
 * Puts the pack {@link keepRunPack} kept back the way Obsidian installs a
 * plugin (the file, the manifest read, the report of the change), closes the
 * settings and the pack notices, clears the vault's notice record, and waits
 * for the Chinese Segmenter's read of that pack.
 */
export async function restoreRunPack(
  vaultId: string,
  noticeTitle: string,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, zotlit, page }, { noticeKey, title }) => {
      app.setting.close();
      for (const notice of document.querySelectorAll<HTMLElement>(".notice"))
        if (notice.textContent.includes(title)) notice.click();
      app.saveLocalStorage(noticeKey, null);
      const manifest = page.scratch.zotlitE2EPackManifest;
      const file = page.scratch.zotlitE2EPackFile;
      delete page.scratch.zotlitE2EPackManifest;
      delete page.scratch.zotlitE2EPackFile;
      if (manifest?.dir) {
        if (file)
          await app.vault.adapter.writeBinary(`${manifest.dir}/main.js`, file);
        await app.plugins.loadManifest(manifest.dir);
        app.plugins.didChange();
      }
      await zotlit.services.chineseSegmenter.runPromise(
        zotlit.services.chineseSegmenter.binary.check,
      );
    },
    { noticeKey: PACK_NOTICE_KEY, title: noticeTitle },
    { timeoutMs: 60_000 },
  );
}

/** Waits until the open settings row `rowName` shows the status `expected`. */
export async function settingRowShows(
  vaultId: string,
  {
    rowName,
    expected,
    what,
  }: { rowName: string; expected: string; what: string },
): Promise<void> {
  await obRunUntil(
    vaultId,
    async ({ page }, { rowName }) => {
      return (
        page.settingRow(rowName)?.querySelector("[role=status]")?.textContent ??
        ""
      );
    },
    { rowName },
    { ready: (value) => value === expected, what },
  );
}

/**
 * Presses the button `actionLabel` of the open settings row `rowName`, and
 * answers the row's button count and the URLs the press opened.
 */
export async function pressSettingRowAction(
  vaultId: string,
  { rowName, actionLabel }: { rowName: string; actionLabel: string },
): Promise<{ buttons: number; opened: string[] }> {
  return await obRun(
    vaultId,
    async ({ page }, { rowName, actionLabel }) => {
      const buttons = Array.from(
        page.settingRow(rowName)?.querySelectorAll("button") ?? [],
      );
      const native = window.open;
      const opened: string[] = [];
      window.open = (url) => {
        opened.push(String(url));
        return null;
      };
      try {
        page.press(
          buttons.find((el) => el.textContent === actionLabel),
          `the action of the row ${rowName}`,
        );
      } finally {
        window.open = native;
      }
      return { buttons: buttons.length, opened };
    },
    { rowName, actionLabel },
  );
}
