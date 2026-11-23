import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SOURCE_MISMATCH_STATUS } from "@zotlit/protocol";

const itemIDs = Array.from({ length: 300 }, (_, i) => 1_000_000 + i);
const items = itemIDs.map((id) => ({ id }) as Zotero.Item);
const changeHeadline = vi.fn();
const addDescription = vi.fn();
const fetch = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "Localization",
    class {
      async formatValue(id: string) {
        return id;
      }
    },
  );
  vi.stubGlobal("Zotero", {
    Prefs: {
      get(key: string) {
        if (key === "extensions.zotlit.notify-url") return "http://localhost";
      },
    },
    Profile: { dir: "/profile" },
    DataDirectory: { dir: "/data" },
    File: { pathToFileURI: (path: string) => `file://${path}` },
    getMainWindow: vi.fn(),
    ProgressWindow: class {
      changeHeadline = changeHeadline;
      addDescription = addDescription;
      show() {}
      startCloseTimer() {}
    },
  });
  await import("@/prefs/index.ts");
});

afterEach(() => vi.unstubAllGlobals());

it("shows the source mismatch when Obsidian discards a batch update", async () => {
  const { updateManyInObsidian } = await import("./obsidian.ts");
  fetch.mockResolvedValueOnce(
    new Response(null, { status: SOURCE_MISMATCH_STATUS }),
  );

  await updateManyInObsidian(items);

  expect(changeHeadline).toHaveBeenLastCalledWith(
    "zotlit-source-mismatch-title",
  );
  expect(addDescription).toHaveBeenCalledWith("zotlit-source-mismatch-message");
  expect(changeHeadline).not.toHaveBeenCalledWith(
    "zotlit-batch-update-sent-title",
  );
});

it("shows the source mismatch when Obsidian discards a batch import", async () => {
  const { importManyInObsidian } = await import("./obsidian.ts");
  fetch.mockResolvedValueOnce(
    new Response(null, { status: SOURCE_MISMATCH_STATUS }),
  );

  await importManyInObsidian(itemIDs, "note");

  expect(changeHeadline).toHaveBeenLastCalledWith(
    "zotlit-source-mismatch-title",
  );
  expect(addDescription).toHaveBeenCalledWith("zotlit-source-mismatch-message");
  expect(changeHeadline).not.toHaveBeenCalledWith(
    "zotlit-batch-import-sent-title",
  );
});

it("shows the handoff when Obsidian accepts a batch update", async () => {
  const { updateManyInObsidian } = await import("./obsidian.ts");
  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

  await updateManyInObsidian(items);

  expect(changeHeadline).toHaveBeenLastCalledWith(
    "zotlit-batch-update-sent-title",
  );
  expect(addDescription).toHaveBeenCalledWith(
    "zotlit-batch-update-sent-message",
  );
});
