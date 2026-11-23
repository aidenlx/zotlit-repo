import { afterEach, expect, it, vi } from "vitest";

import * as electron from "@zotlit/obsidian-desktop/require.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import {
  copyBackupFolderPath,
  openBackupFolder,
} from "./integration-backup-notice.ts";

const BACKUPS = [
  "/papers/thesis/.zotlit-pandoc-ab12/.previous-defaults.yaml",
  "/papers/thesis/.zotlit-pandoc-ab12/.previous-zotlit-cite.lua",
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubOpenPath(result: string) {
  const openPath = vi.fn(async (_path: string) => result);
  vi.spyOn(electron, "requireElectron").mockReturnValue(
    stubService<ReturnType<typeof electron.requireElectron>>("Electron", {
      shell: stubService<Electron.Shell>("Shell", { openPath }),
    }),
  );
  return openPath;
}

it("copies the folder that contains the backups", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  await copyBackupFolderPath([
    "/papers/thesis/.zotlit-pandoc-ab12/.previous-defaults.yaml",
    "/papers/thesis/.zotlit-pandoc-ab12/.previous-zotlit-cite.lua",
  ]);

  expect(writeText.mock.calls).toEqual([
    ["/papers/thesis/.zotlit-pandoc-ab12"],
  ]);
});

it("opens the folder that contains the backups", async () => {
  const openPath = stubOpenPath("");

  await openBackupFolder(BACKUPS);

  expect(openPath.mock.calls).toEqual([["/papers/thesis/.zotlit-pandoc-ab12"]]);
});

it("fails with the reason the system cannot open the backup folder", async () => {
  stubOpenPath("Failed to open path");

  await expect(openBackupFolder(BACKUPS)).rejects.toThrow(
    "Failed to open path",
  );
});
