import {
  OLD_BINARY_IDS,
  OLD_STORE_CLEANUP_KEY,
  OLD_STORE_ROOT,
  oldDeclinedKey,
} from "@zotlit/plugin-services/core/managed-binary/old-store.ts";
import {
  PACK_NOTICE_KEY,
  RESOURCE_PACK_ID,
} from "@zotlit/plugin-services/core/managed-binary/resource-pack.ts";
import type { OldStoreCleanupOutcome } from "@zotlit/plugin-services/obsidian/managed-binary/old-store-cleanup.ts";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { turnZotlitOff } from "./zotlit-restart.ts";

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

const OLD_DEVICE_DATA = {
  root: OLD_STORE_ROOT,
  folders: OLD_BINARY_IDS,
  keys: OLD_BINARY_IDS.map(oldDeclinedKey),
  cleanupKey: OLD_STORE_CLEANUP_KEY,
  noticeKey: PACK_NOTICE_KEY,
};

export async function seedDownloadedBinaries(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app }, { root, folders, keys }) => {
      const store = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(root, { create: true });
      for (const folder of folders) {
        const file = await (
          await store.getDirectoryHandle(folder, { create: true })
        ).getFileHandle("e2e.wasm", { create: true });
        const writable = await file.createWritable();
        await writable.write(new Uint8Array([0, 97, 115, 109]));
        await writable.close();
      }
      for (const key of keys) app.saveLocalStorage(key, true);
    },
    OLD_DEVICE_DATA,
  );
}

export interface DownloadedBinaries {
  folders: string[] | null;
  dismissed: string[];
  cleaned: boolean;
}

export async function downloadedBinaries(
  vaultId: string,
): Promise<DownloadedBinaries> {
  return await obRun(
    vaultId,
    async ({ app }, { root, keys, cleanupKey }) => {
      let folders: string[] | null = null;
      try {
        const store = await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(root);
        folders = [];
        for await (const name of store.keys()) folders.push(name);
        folders.sort();
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError"))
          throw error;
      }
      return {
        folders,
        dismissed: keys.filter((key) => app.loadLocalStorage(key) !== null),
        cleaned: app.loadLocalStorage(cleanupKey) === true,
      };
    },
    OLD_DEVICE_DATA,
  );
}

export async function removeDownloadedBinaries(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ app }, { root, keys, cleanupKey }) => {
      try {
        await (
          await navigator.storage.getDirectory()
        ).removeEntry(root, { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "NotFoundError"))
          throw error;
      }
      for (const key of keys) app.saveLocalStorage(key, null);
      app.saveLocalStorage(cleanupKey, true);
    },
    OLD_DEVICE_DATA,
  );
}

export async function restartZotlit(
  vaultId: string,
  { asUpdated }: { asUpdated: boolean },
): Promise<OldStoreCleanupOutcome> {
  await turnZotlitOff(vaultId);
  return await obRun(
    vaultId,
    async ({ app, zotlit }, { cleanupKey, noticeKey, asUpdated }) => {
      if (asUpdated) {
        app.saveLocalStorage(cleanupKey, null);
        app.saveLocalStorage(noticeKey, null);
      }
      await app.plugins.enablePlugin("zotlit");
      const s = zotlit.services;
      return await s.bridge.runPromise(s.oldStoreCleanup.outcome);
    },
    { ...OLD_DEVICE_DATA, asUpdated },
    { timeoutMs: 120_000 },
  );
}
