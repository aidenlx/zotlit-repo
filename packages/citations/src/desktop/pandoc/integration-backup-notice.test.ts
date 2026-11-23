import { afterEach, expect, it, vi } from "vitest";

import { copyBackupFolderPath } from "./integration-backup-notice.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
