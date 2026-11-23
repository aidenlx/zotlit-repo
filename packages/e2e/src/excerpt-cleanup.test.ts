import { expect, it, vi } from "vitest";

import {
  deferExcerptCleanup,
  deferExcerptImportCleanup,
  withExcerptCleanup,
} from "./excerpt-cleanup.ts";

it("reports a twice-failed restoration after running the remaining cleanup", async ({
  annotate,
}) => {
  await annotate("https://github.com/aidenlx/zotlit-repo/issues/182", "issue");
  const layout = vi.fn(async () => {});
  const noteError = new Error("Obsidian did not answer");
  const note = vi.fn(async () => {
    throw noteError;
  });

  await expect(
    withExcerptCleanup(async (cleanup) => {
      deferExcerptCleanup(cleanup, "restore the layout", layout);
      deferExcerptCleanup(cleanup, "restore the Imported Note", note);
    }),
  ).rejects.toMatchObject({
    message: "Excerpt acceptance could not restore the Imported Note",
    cause: noteError,
  });
  expect(note).toHaveBeenCalledTimes(2);
  expect(layout).toHaveBeenCalledOnce();
});

it("reports the original assertion and each cleanup failure to Vitest", async () => {
  const assertion = new Error("An Excerpt Image is missing");
  const restore = async () => {
    throw new Error("Obsidian did not answer");
  };
  const failure = await withExcerptCleanup(async (cleanup) => {
    deferExcerptCleanup(cleanup, "restore the color filter", restore);
    deferExcerptCleanup(cleanup, "restore the layout", restore);
    throw assertion;
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([
    assertion,
    expect.objectContaining({
      message: "Excerpt acceptance could not restore the layout",
    }),
    expect.objectContaining({
      message: "Excerpt acceptance could not restore the color filter",
    }),
  ]);
});

it("waits for the in-app import to settle before restoring its data", async () => {
  const waiting = Promise.withResolvers<void>();
  const imported = Promise.withResolvers<void>();
  const assets = vi.fn(async () => {});
  const note = vi.fn(async () => {});
  const caseResult = withExcerptCleanup(async (cleanup) => {
    const importCleanup = deferExcerptImportCleanup(cleanup, () => {
      waiting.resolve();
      return imported.promise;
    });
    deferExcerptCleanup(importCleanup, "restore the Imported Note", note);
    deferExcerptCleanup(importCleanup, "remove the new assets", assets);
  });

  await waiting.promise;
  expect(assets).not.toHaveBeenCalled();
  expect(note).not.toHaveBeenCalled();
  imported.resolve();
  await caseResult;
  expect(assets).toHaveBeenCalledOnce();
  expect(note).toHaveBeenCalledOnce();
});

it("reports an unsettled import and only runs the independent restorations", async () => {
  const layout = vi.fn(async () => {});
  const note = vi.fn(async () => {});
  const settlement = vi.fn(async () => {
    throw new Error("The import is still running");
  });

  await expect(
    withExcerptCleanup(async (cleanup) => {
      deferExcerptCleanup(cleanup, "restore the layout", layout);
      const importCleanup = deferExcerptImportCleanup(cleanup, settlement);
      deferExcerptCleanup(importCleanup, "restore the Imported Note", note);
    }),
  ).rejects.toThrow("Excerpt acceptance could not wait for the note import");
  expect(settlement).toHaveBeenCalledTimes(2);
  expect(note).not.toHaveBeenCalled();
  expect(layout).toHaveBeenCalledOnce();
});
