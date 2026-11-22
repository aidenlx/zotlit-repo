import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { FileSystemAdapter } from "obsidian";
import { expect } from "vitest";

import type { ExcerptRequest } from "@zotlit/annotations/obsidian/excerpt-image/contract.ts";
import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  ITEMS,
  NOTES,
} from "@zotlit/scripts/fixture";
import type { FixtureAnnotation } from "@zotlit/scripts/fixture";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { ExcerptImportState } from "./page-excerpt-types.ts";
import type { PagePdfReaderView } from "./page-notes-types.ts";

const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
const vaultPath = attachment.path;
const item = ITEMS.find(({ itemID }) => itemID === attachment.parentItemID)!;
const annotations = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === attachment.itemID,
);
const embedded = annotations.filter(({ type }) => type === 3 || type === 4);
const target = annotations.find(
  (annotation): annotation is Extract<FixtureAnnotation, { type: 4 }> =>
    annotation.type === 4 &&
    annotations.filter((other) => other.color === annotation.color).length ===
      1,
)!;
const noteItem = NOTES.find(
  (candidate) =>
    candidate.libraryID === attachment.libraryID &&
    candidate.note.includes(target.key),
)!;
const editedColor = "#2ea8e5";
const editedComment = "Saved-edit acceptance";

interface Loads {
  borrowed: number;
  detached: number;
  fileOpens: number;
  documentLoads: number;
}

interface RendererDiagnostics {
  loads: Loads;
  phase: string;
  jobActive: boolean;
  fileOpen: boolean;
  documentOpen: boolean;
  renderTaskActive: boolean;
}

function loadsBetween(
  before: RendererDiagnostics,
  after: RendererDiagnostics,
): Loads {
  return {
    borrowed: after.loads.borrowed - before.loads.borrowed,
    detached: after.loads.detached - before.loads.detached,
    fileOpens: after.loads.fileOpens - before.loads.fileOpens,
    documentLoads: after.loads.documentLoads - before.loads.documentLoads,
  };
}

async function cleanupStep(step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch {
    try {
      await step();
    } catch (error) {
      console.warn(
        `Excerpt acceptance cleanup step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function importState(vaultId: string): Promise<string> {
  return obRun(
    vaultId,
    async ({ app, page: helpers }) => {
      return JSON.stringify({
        settled: helpers.scratch.__zotlitExcerptImport?.settled ?? null,
        error: helpers.scratch.__zotlitExcerptImport?.error ?? null,
        modals: Array.from(
          document.querySelectorAll(".modal-container .modal"),
        ).map((element) => (element.textContent ?? "").slice(0, 300)),
        notices: Array.from(document.querySelectorAll(".notice")).map(
          (element) => (element.textContent ?? "").slice(0, 200),
        ),
        imported: app.vault
          .getFiles()
          .map((file) => file.path)
          .filter((path) => path.includes("zotlit")),
      });
    },
    undefined,
  ).catch((error: unknown) => `import state unavailable: ${String(error)}`);
}

function importSettlement(vaultId: string): () => Promise<void> {
  let asked: Promise<void> | null = null;
  return () =>
    (asked ??= settleImport(vaultId).catch((error: unknown) => {
      asked = null;
      throw error;
    }));
}

async function settleImport(vaultId: string): Promise<void> {
  try {
    await obRunUntil(
      vaultId,
      async ({ page: helpers }) => {
        const button = document.querySelector<HTMLButtonElement>(
          ".modal-container .modal .modal-button-container button.mod-destructive",
        );
        if (button) button.click();
        return !!helpers.scratch.__zotlitExcerptImport?.settled;
      },
      undefined,
      {
        tries: 240,
        what: "the excerpt import to settle after any overwrite confirm",
      },
    );
  } catch (error) {
    throw new Error(
      `the note import did not settle: ${await importState(vaultId)}`,
      { cause: error },
    );
  }
}

async function installUrlProbe(vaultId: string): Promise<void> {
  expect(
    await obRun(
      vaultId,
      async ({ page: helpers }) => {
        if (helpers.scratch.__zotlitExcerptUrlProbe)
          throw new Error("The URL probe is already installed");
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        const state = {
          create,
          revoke,
          created: [] as string[],
          revoked: [] as string[],
        };
        const others = new Set<string>();
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          if (blob instanceof Blob && blob.type.startsWith("image/"))
            state.created.push(url);
          else others.add(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          if (!others.delete(url)) state.revoked.push(url);
          return revoke(url);
        };
        helpers.scratch.__zotlitExcerptUrlProbe = state;
        return true;
      },
      undefined,
    ),
  ).toBe(true);
}

async function removeUrlProbe(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ page: helpers }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      if (!state) return;
      URL.createObjectURL = state.create;
      URL.revokeObjectURL = state.revoke;
      delete helpers.scratch.__zotlitExcerptUrlProbe;
    },
    undefined,
  );
}

export async function verifyReaderBackedExcerpts(
  vaultId: string,
): Promise<void> {
  const m = await import("@zotlit/plugin-messages/messages.ts");
  const layout = await obRun(
    vaultId,
    async ({ app }) => {
      return JSON.stringify(app.workspace.getLayout());
    },
    undefined,
  );
  const basePath = await obRun(
    vaultId,
    async ({ app }) => {
      return (app.vault.adapter as FileSystemAdapter).getBasePath();
    },
    undefined,
  );
  const runtime = await obRun(
    vaultId,
    async () => {
      const versions = process.versions;
      return {
        userAgent: navigator.userAgent,
        electron: versions.electron ?? null,
        chrome: versions.chrome ?? null,
        node: versions.node,
      };
    },
    undefined,
  );
  const existingFiles = new Set(
    await obRun(
      vaultId,
      async ({ app }) => {
        return app.vault.getFiles().map((file) => file.path);
      },
      undefined,
    ),
  );
  const filterKey = JSON.stringify(`zotlit-annot-filter-${item.key}`);
  const savedFilter = await obRun(
    vaultId,
    async ({ app }, { storageKey }) => {
      return JSON.stringify(app.loadLocalStorage(storageKey) ?? null);
    },
    { storageKey: JSON.parse(filterKey) },
  );
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ app }, { storageKey, storageValue }) => {
          app.saveLocalStorage(storageKey, storageValue);
        },
        {
          storageKey: JSON.parse(filterKey),
          storageValue: JSON.parse(savedFilter),
        },
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ app }, { layout }) => {
          await app.workspace.changeLayout(JSON.parse(layout));
        },
        { layout },
      );
    }),
  );

  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit, page }, { vaultPath }) => {
        for (const leaf of app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ))
          leaf.detach();
        await zotlit.services.bridge.runPromise(
          zotlit.services.excerptImage.clear,
        );
        const file = app.vault.getFileByPath(vaultPath!);
        if (!file)
          throw new Error("The Fixture PDF is not in the Fixture Vault");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({
          type: page.reader.viewType,
          state: { file: file.path },
          active: true,
        });
        app.workspace.setActiveLeaf(leaf, { focus: true });
        return true;
      },
      { vaultPath },
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app, zotlit, page }, { vaultPath, pageNumber }) => {
      const state = JSON.parse(
        (function () {
          const leaves = app.workspace.getLeavesOfType(page.reader.viewType);
          const leaf = leaves.find(
            (candidate) =>
              (candidate.view as PagePdfReaderView).file?.path === vaultPath,
          );
          const pageEl = leaf?.view.containerEl.querySelector(
            `.page[data-page-number="${pageNumber}"]`,
          );
          const canvas = pageEl?.querySelector("canvas");
          return JSON.stringify({
            leaves: leaves.length,
            page: !!pageEl,
            canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
            borrowed: !!zotlit.services.bridge.runSync(
              zotlit.services.pdfAnnotationEditor.borrowDocument(
                (app.vault.adapter as FileSystemAdapter).getFullPath(
                  vaultPath!,
                ),
              ),
            ),
          });
        })(),
      );
      return state.page && state.canvas && state.borrowed;
    },
    { vaultPath, pageNumber: target.position.pageIndex + 1 },
    {
      tries: 80,
      what: "the PDF page to render with a sized canvas and a borrowed document",
    },
  );
  const held = await obRun(
    vaultId,
    async ({ app, zotlit, page }, { vaultPath, pageNumber }) => {
      const leaves = app.workspace.getLeavesOfType(page.reader.viewType);
      const leaf = leaves.find(
        (candidate) =>
          (candidate.view as PagePdfReaderView).file?.path === vaultPath,
      );
      const pageEl = leaf?.view.containerEl.querySelector(
        `.page[data-page-number="${pageNumber}"]`,
      );
      const canvas = pageEl?.querySelector("canvas");
      return {
        leaves: leaves.length,
        page: !!pageEl,
        canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
        borrowed: !!zotlit.services.bridge.runSync(
          zotlit.services.pdfAnnotationEditor.borrowDocument(
            (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
          ),
        ),
      };
    },
    { vaultPath, pageNumber: target.position.pageIndex + 1 },
  );
  expect(held).toMatchObject({ page: true, canvas: true, borrowed: true });

  const borrowed = await obRun(
    vaultId,
    async (
      { app, zotlit },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const service = services.excerptImage;
      const request = requestFor(targetKey);
      await zotlit.services.bridge.runPromise(service.clear);
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await zotlit.services.bridge.runPromise(
        service.resolve(request),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return {
        before,
        after,
        outcome:
          outcome.kind === "available"
            ? {
                kind: outcome.kind,
                provenance: outcome.provenance,
                sha256: require("crypto")
                  .createHash("sha256")
                  .update(outcome.bytes)
                  .digest("hex"),
              }
            : { kind: outcome.kind },
        pixels:
          outcome.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(outcome.bytes, outcome.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(borrowed.outcome).toMatchObject({
    kind: "available",
    provenance: "rendered",
  });
  expect(borrowed.outcome.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(borrowed.pixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(borrowed.pixels!.width).toBeGreaterThan(0);
  expect(loadsBetween(borrowed.before, borrowed.after)).toEqual({
    borrowed: 1,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  expect(borrowed.after).toMatchObject({
    phase: "idle",
    jobActive: false,
    fileOpen: false,
    documentOpen: false,
    renderTaskActive: false,
  });
  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit, page }, { vaultPath, pageNumber }) => {
        const leaves = app.workspace.getLeavesOfType(page.reader.viewType);
        const leaf = leaves.find(
          (candidate) =>
            (candidate.view as PagePdfReaderView).file?.path === vaultPath,
        );
        const pageEl = leaf?.view.containerEl.querySelector(
          `.page[data-page-number="${pageNumber}"]`,
        );
        const canvas = pageEl?.querySelector("canvas");
        return {
          leaves: leaves.length,
          page: !!pageEl,
          canvas: !!canvas && canvas.width > 0 && canvas.height > 0,
          borrowed: !!zotlit.services.bridge.runSync(
            zotlit.services.pdfAnnotationEditor.borrowDocument(
              (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
            ),
          ),
        };
      },
      { vaultPath, pageNumber: target.position.pageIndex + 1 },
    ),
  ).toEqual(held);

  const importedNote = await obRun(
    vaultId,
    async ({ app, zotlit }, { noteItemKey }) => {
      const services = zotlit.services;
      await services.bridge.runPromise(services.noteIndex.whenIndexed);
      const file = services.bridge.runSync(
        services.noteIndex.getImportedNoteByNoteKey(noteItemKey),
      )[0];
      if (!file)
        throw new Error(
          `The Fixture Vault holds no Imported Note for ${noteItemKey}`,
        );
      return { path: file.path, source: await app.vault.read(file) };
    },
    { noteItemKey: noteItem.key },
  );
  const templateBinding = await obRun(
    vaultId,
    async ({ zotlit }) => {
      const { settings, bridge } = zotlit.services;
      return {
        enabled: bridge.runSync(settings.current)["note.default-profile"]
          .bindings["note.import-annotations-as-template"],
      };
    },
    undefined,
  );
  const settleImport = importSettlement(vaultId);
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obRun(
        vaultId,
        async ({ app }, { importedNotePath, source }) => {
          const file = app.vault.getFileByPath(importedNotePath);
          if (file) await app.vault.modify(file, source);
        },
        { importedNotePath: importedNote.path, source: importedNote.source },
      );
    }),
  );
  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obRun(
        vaultId,
        async ({ zotlit }, { enabled }) => {
          zotlit.services.bridge.runSync(
            zotlit.services.settings.update((current) => ({
              "note.default-profile": {
                ...current["note.default-profile"],
                bindings: {
                  ...current["note.default-profile"].bindings,
                  "note.import-annotations-as-template": enabled,
                },
              },
            })),
          );
        },
        { enabled: templateBinding.enabled },
      );
    }),
  );

  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      const known = JSON.stringify([...existingFiles]);
      await obRun(
        vaultId,
        async ({ app }, { knownKeys }) => {
          const known = new Set(knownKeys);
          for (const file of app.vault.getFiles()) {
            if (!known.has(file.path)) await app.vault.delete(file);
          }
        },
        { knownKeys: JSON.parse(known) },
      );
    }),
  );

  const prepared = await obRun(
    vaultId,
    async ({ app, zotlit }, { attachmentKey, libraryId, vaultPath }) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const service = services.excerptImage;
      const keys = list.annotations
        .filter(
          (annotation) =>
            annotation.type === "image" || annotation.type === "ink",
        )
        .map((annotation) => annotation.key);
      const outcomes = [];
      for (const key of keys) {
        const outcome = await zotlit.services.bridge.runPromise(
          service.resolve(requestFor(key)),
        );
        outcomes.push({
          key,
          kind: outcome.kind,
          sha256:
            outcome.kind === "available"
              ? require("crypto")
                  .createHash("sha256")
                  .update(outcome.bytes)
                  .digest("hex")
              : null,
        });
      }
      return { keys, outcomes };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
    },
  );
  expect(prepared.keys.slice().sort()).toEqual(
    embedded.map(({ key }) => key).sort(),
  );
  expect(prepared.outcomes.map(({ kind }) => kind)).toEqual(
    embedded.map(() => "available"),
  );
  expect(prepared.outcomes.find(({ key }) => key === target.key)?.sha256).toBe(
    borrowed.outcome.sha256,
  );

  cleanup.defer(() =>
    cleanupStep(async () => {
      await settleImport();
      await obRun(
        vaultId,
        async ({ page: helpers }) => {
          delete helpers.scratch.__zotlitExcerptImport;
          for (const button of document.querySelectorAll<HTMLElement>(
            ".modal-container .modal .modal-close-button",
          ))
            button.click();
        },
        undefined,
      );
    }),
  );
  expect(
    await obRun(
      vaultId,
      async ({ zotlit, page: helpers }, { itemID }) => {
        const services = zotlit.services;
        const memory = () => {
          try {
            const value = process.memoryUsage();
            return {
              rss: value.rss,
              heapUsed: value.heapUsed,
              heapTotal: value.heapTotal,
            };
          } catch (error) {
            return String(error);
          }
        };
        services.bridge.runSync(
          services.settings.update((current) => ({
            "note.default-profile": {
              ...current["note.default-profile"],
              bindings: {
                ...current["note.default-profile"].bindings,
                "note.import-annotations-as-template": true,
              },
            },
          })),
        );
        const state: ExcerptImportState =
          (helpers.scratch.__zotlitExcerptImport = {
            settled: false,
            startedAt: performance.now(),
            settledAt: null,
            before: (() => {
              const snapshot =
                zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
              return {
                loads: snapshot.loads,
                phase: snapshot.phase,
                jobActive: snapshot.jobActive,
                fileOpen: snapshot.fileOpen,
                documentOpen: snapshot.documentOpen,
                renderTaskActive: snapshot.renderTaskActive,
              };
            })(),
            memoryBefore: memory(),
            memoryAfter: null,
            after: null,
            result: null,
            error: null,
          });
        await services.bridge.runPromise(services.noteIndex.whenIndexed);
        void services.batchImport
          .runBatchImport("note", [itemID])
          .then(
            (result) => {
              state.after = (() => {
                const snapshot =
                  zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
                return {
                  loads: snapshot.loads,
                  phase: snapshot.phase,
                  jobActive: snapshot.jobActive,
                  fileOpen: snapshot.fileOpen,
                  documentOpen: snapshot.documentOpen,
                  renderTaskActive: snapshot.renderTaskActive,
                };
              })();
              state.result = result;
            },
            (error) => {
              state.after = (() => {
                const snapshot =
                  zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
                return {
                  loads: snapshot.loads,
                  phase: snapshot.phase,
                  jobActive: snapshot.jobActive,
                  fileOpen: snapshot.fileOpen,
                  documentOpen: snapshot.documentOpen,
                  renderTaskActive: snapshot.renderTaskActive,
                };
              })();
              state.error = error?.stack ?? String(error);
            },
          )
          .finally(() => {
            state.memoryAfter = memory();
            state.settledAt = performance.now();
            state.settled = true;
          });
        return true;
      },
      { itemID: noteItem.itemID },
    ),
  ).toBe(true);
  await settleImport();
  const imported = await obRun(
    vaultId,
    async ({ page: helpers }) => {
      const state = helpers.scratch.__zotlitExcerptImport;
      if (!state) throw new Error("The note import state is gone");
      if (state.error) throw new Error(state.error);
      const value = {
        before: state.before,
        after: state.after,
        result: state.result,
        elapsedMs: state.settledAt! - state.startedAt,
        memoryBefore: state.memoryBefore,
        memoryAfter: state.memoryAfter,
      };
      delete helpers.scratch.__zotlitExcerptImport;
      return value;
    },
    undefined,
  );
  expect(imported.result).toMatchObject({ outcome: "single" });
  expect(imported.elapsedMs).toBeGreaterThan(0);
  expect(loadsBetween(imported.before, imported.after!)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });
  const written = (
    await obRun(
      vaultId,
      async ({ app }) => {
        return app.vault.getFiles().map((file) => file.path);
      },
      undefined,
    )
  ).filter((path) => !existingFiles.has(path));
  const assets = written.filter((path) =>
    path.split("/").at(-1)!.startsWith("zotlit-excerpt-"),
  );
  const digests = await Promise.all(
    assets.map(async (path) =>
      createHash("sha256")
        .update(await readFile(join(basePath, path)))
        .digest("hex"),
    ),
  );
  const published = assets.filter(
    (_path, index) => digests[index] === borrowed.outcome.sha256,
  );
  expect(published).toHaveLength(1);
  const overwritten = await readFile(
    join(basePath, importedNote.path),
    "utf-8",
  );
  expect(overwritten).not.toBe(importedNote.source);
  expect(overwritten).toContain(published[0]!.split("/").at(-1)!);

  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:open-annot-view");
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async (
      { app, page: helpers },
      {
        itemKey,
        filterTriggerLabel,
        activeTriggerPrefix,
        colorListLabel,
        expectedColor,
      },
    ) => {
      const leaf = app.workspace.getLeavesOfType("zotero-annotation-view")[0];
      if (!leaf) return "no view";
      const state = (leaf.view as AnnotationView).snapshot;
      if (state.followMode !== "pinned" || state.pinnedItemKey !== itemKey)
        await leaf.setViewState({
          type: "zotero-annotation-view",
          state: {
            followMode: "pinned",
            previousMode: "active-tab",
            pinnedItemKey: itemKey,
          },
          active: true,
        });
      const { press, until } = helpers;
      try {
        const root = leaf.view.containerEl;
        const trigger = Array.from(
          root.querySelectorAll<HTMLButtonElement>("button[aria-label]"),
        ).find(
          (button) =>
            button.getAttribute("aria-label") === filterTriggerLabel ||
            button.getAttribute("aria-label")!.startsWith(activeTriggerPrefix),
        );
        if (!trigger) return "no colour Chooser";
        press(trigger, "colour Chooser");
        const list = await until("colour list opens", () => {
          const list = Array.from(
            root.ownerDocument.querySelectorAll<HTMLElement>(
              '[role="listbox"]',
            ),
          ).find(
            (list) =>
              root.ownerDocument.getElementById(
                list.getAttribute("aria-labelledby")!,
              )?.textContent === colorListLabel,
          );
          return list?.checkVisibility() ? list : null;
        });
        const row = Array.from(
          list.querySelectorAll<HTMLElement>('[role="option"]'),
        ).find(
          (option) =>
            option
              .querySelector<HTMLElement>('[style*="--zt-swatch-color"]')
              ?.style.getPropertyValue("--zt-swatch-color")
              .trim()
              .toLowerCase() === expectedColor,
        );
        if (!row) return "no swatch";
        if (row.getAttribute("aria-selected") !== "true") {
          press(row, "colour row");
          await until(
            "colour filter applies",
            () => row.getAttribute("aria-selected") === "true",
          );
        }
        (
          root.ownerDocument.activeElement ?? root.ownerDocument.body
        ).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        return "demanded";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
    {
      itemKey: item.key,
      filterTriggerLabel: m.annot_view_filter_color_trigger(),
      activeTriggerPrefix: m.annot_view_filter_color_trigger_active({
        colors: "",
      }),
      colorListLabel: m.annot_view_filter_color_list(),
      expectedColor: target.color.toLowerCase(),
    },
    {
      ready: (value) => value === "demanded",
      tries: 80,
      what: "the Annotation View to pin the Item, list the expected color and leave the target Annotation's card alone",
    },
  );
  await obRunUntil(
    vaultId,
    async ({ app }) => {
      const cards = Array.from(
        new Set(
          Array.from(
            app.workspace
              .getLeavesOfType("zotero-annotation-view")[0]!
              .view.containerEl.querySelectorAll(
                ".zt-annot-card[data-zotero-annotation-key]",
              ),
          ).map((card) => card.getAttribute("data-zotero-annotation-key")),
        ),
      );
      return cards;
    },
    undefined,
    {
      ready: (value) => isDeepStrictEqual(value, [target.key]),
      tries: 80,
      what: "the Annotation View to list the expected annotation card keys",
    },
  );
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL",
    },
  );

  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          zotlit.services.excerptImage.rendererDiagnostics!.release();
        },
        undefined,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  await installUrlProbe(vaultId);
  const demand = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(demand.src).toMatch(/^blob:/);
  expect(demand.revoked).toEqual([]);

  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        zotlit.services.excerptImage.rendererDiagnostics!.hold(
          "document-loading",
        );
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  expect(
    await obRun(
      vaultId,
      async ({ app, zotlit, page }) => {
        await zotlit.services.bridge.runPromise(
          zotlit.services.excerptImage.clear,
        );
        for (const leaf of app.workspace.getLeavesOfType(page.reader.viewType))
          leaf.detach();
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app, zotlit, page }, { vaultPath }) => {
      return (
        app.workspace.getLeavesOfType(page.reader.viewType).length === 0 &&
        !zotlit.services.bridge.runSync(
          zotlit.services.pdfAnnotationEditor.borrowDocument(
            (app.vault.adapter as FileSystemAdapter).getFullPath(vaultPath!),
          ),
        )
      );
    },
    { vaultPath },
    {
      tries: 40,
      what: "the PDF tabs to close and release the borrowed PDF document",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }) => {
        (
          app.workspace.getLeavesOfType("zotero-annotation-view")[0]!
            .view as AnnotationView
        ).gestures!.onRefresh();
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ zotlit }) => {
      const state = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return state.phase === "document-loading" && state.jobActive;
    },
    undefined,
    {
      tries: 80,
      what: "the excerpt renderer to start loading the document",
    },
  );
  const replacing = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(replacing).toMatchObject({
    src: demand.src,
    decoded: true,
    created: demand.created,
    revoked: [],
  });

  await obRun(
    vaultId,
    async ({ zotlit }) => {
      zotlit.services.excerptImage.rendererDiagnostics!.release();
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      {
        cardSelector,
        pixelsWidth,
        pixelsHeight,
        pixelData,
        createdLength,
        imageSrc,
      },
    ) => {
      const pixels = JSON.parse(
        await (async () => {
          const image = app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
            .find(Boolean)
            ?.querySelector("img");
          if (!image || !image.complete || image.naturalWidth === 0)
            return JSON.stringify(null);
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          try {
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Card pixel canvas unavailable");
            context.drawImage(image, 0, 0);
            const data = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            return JSON.stringify({
              width: canvas.width,
              height: canvas.height,
              pixels: require("crypto")
                .createHash("sha256")
                .update(new Uint8Array(data.buffer))
                .digest("hex"),
            });
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        })(),
      );
      if (
        !pixels ||
        pixels.width !== pixelsWidth ||
        pixels.height !== pixelsHeight ||
        pixels.pixels !== pixelData
      )
        return false;
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      const diagnostics = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      if (
        state.created.length === createdLength &&
        image!.src === imageSrc &&
        !diagnostics.jobActive &&
        diagnostics.phase === "idle"
      )
        return true;
      return (
        state.created.length > createdLength &&
        image!.src === state.created[state.created.length - 1] &&
        state.revoked.includes(imageSrc!)
      );
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
      pixelsWidth: borrowed.pixels!.width,
      pixelsHeight: borrowed.pixels!.height,
      pixelData: borrowed.pixels!.pixels,
      createdLength: demand.created.length,
      imageSrc: demand.src,
    },
    {
      tries: 80,
      what: "the card image to show the expected cropped pixels and URL",
    },
  );
  const replaced = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  const allocated = replaced.created.slice(demand.created.length);
  if (replaced.src === demand.src) {
    expect(allocated, "an unchanged URL needs no new allocation").toEqual([]);
    expect(replaced.revoked).not.toContain(replaced.src);
  } else {
    expect(replaced.src).toBe(allocated.at(-1));
    expect(
      replaced.revoked.filter((url) => url === demand.src),
      "the replaced image's URL is released exactly as the new one is shown",
    ).toHaveLength(1);
  }
  expect(replaced.src).toMatch(/^blob:/);
  expect(replaced.diagnostics).toMatchObject({
    jobActive: false,
    renderTaskActive: false,
  });
  expect(loadsBetween(demand.diagnostics, replaced.diagnostics)).toEqual({
    borrowed: 0,
    detached: 1,
    fileOpens: 1,
    documentLoads: 1,
  });
  console.info("Reader-backed excerpt evidence", {
    runtime,
    sha256: borrowed.outcome.sha256,
    borrowed: loadsBetween(borrowed.before, borrowed.after),
    pixels: borrowed.pixels,
    import: {
      outcome: imported.result!.outcome,
      write:
        imported.result!.outcome === "single"
          ? imported.result!.write
          : undefined,
      note: importedNote.path,
      loads: loadsBetween(imported.before, imported.after!),
      elapsedMs: imported.elapsedMs,
      memoryBefore: imported.memoryBefore,
      memoryAfter: imported.memoryAfter,
      prepared: prepared.outcomes.length,
    },
    asset: published[0],
    detachedFallback: {
      loads: loadsBetween(demand.diagnostics, replaced.diagnostics),
      pixels: borrowed.pixels,
      url: {
        painted: replaced.src,
        previous: demand.src,
        reused: replaced.src === demand.src,
      },
    },
  });
}

export interface MultiPdfExcerpt {
  readonly attachmentKey: string;
  readonly pdfPath: string;
  readonly pageIndex: number;
  readonly rect: readonly [number, number, number, number];
}

interface BatchRequest {
  attachmentKey: string;
  ms: number;
  kind: string;
  provenance?: string;
  bytes?: number;
  sha256?: string;
  loads: Loads;
}

interface BatchMemoryPeak {
  samples: number;
  node: { rss: number; heapUsed: number; heapTotal: number };
  electron: { answers: number; nulls: number; private: number };
}

interface MultiPdfBatch {
  coldMs: number;
  warmMs: number;
  cold: BatchRequest[];
  warm: BatchRequest[];
  memory: BatchMemoryPeak;
  excerpts: { attachmentKey: string; pdfPath: string }[];
}

interface BatchChunk {
  ms: number;
  requests: BatchRequest[];
  memory: BatchMemoryPeak;
}

export async function verifyMultiPdfExcerptBatch(
  vaultId: string,
  excerpts: readonly MultiPdfExcerpt[],
): Promise<void> {
  const pdfs = new Set(excerpts.map(({ attachmentKey }) => attachmentKey));
  const measurePass = (): Promise<BatchChunk> =>
    obRun(
      vaultId,
      async ({ zotlit }, { excerpts }) => {
        const service = zotlit.services.excerptImage;
        const sampleMemory = () => {
          try {
            const value = process.memoryUsage();
            return {
              rss: value.rss,
              heapUsed: value.heapUsed,
              heapTotal: value.heapTotal,
            };
          } catch (error) {
            return String(error);
          }
        };
        const request = (
          excerpt: MultiPdfExcerpt,
          index: number,
        ): ExcerptRequest => ({
          annotation: {
            key: `MULTIPDF${String(index).padStart(2, "0")}`,
            parentKey: excerpt.attachmentKey,
            type: "image",
            color: "#ff0000",
            comment: null,
            text: null,
            pageLabel: String(excerpt.pageIndex + 1),
            tags: [],
            version: null,
            sortIndex: "",
            lock: null,
            position: {
              kind: "pdf-rects",
              pageIndex: excerpt.pageIndex,
              rects: [[...excerpt.rect]],
            },
          },
          source: { kind: "zotero-local-api", serverID: "excerpt-acceptance" },
          sourceScope: "excerpt-acceptance",
          attachmentKey: excerpt.attachmentKey,
          libraryID: 1,
          pdfPath: excerpt.pdfPath,
          zoteroPngPath: null,
        });
        const memory = {
          samples: 0,
          node: { rss: 0, heapUsed: 0, heapTotal: 0 },
          electron: { answers: 0, nulls: 0, private: 0 },
        };
        const observeMemory = async () => {
          const value = sampleMemory();
          if (typeof value !== "string") {
            memory.samples += 1;
            memory.node.rss = Math.max(memory.node.rss, value.rss);
            memory.node.heapUsed = Math.max(
              memory.node.heapUsed,
              value.heapUsed,
            );
            memory.node.heapTotal = Math.max(
              memory.node.heapTotal,
              value.heapTotal,
            );
          }
          const deadline =
            Promise.withResolvers<Electron.ProcessMemoryInfo | null>();
          setTimeout(() => deadline.resolve(null), 1000);
          const info = await Promise.race([
            process.getProcessMemoryInfo().catch(() => null),
            deadline.promise,
          ]);
          if (info && Number.isFinite(info.private)) {
            memory.electron.answers += 1;
            memory.electron.private = Math.max(
              memory.electron.private,
              info.private,
            );
          } else {
            memory.electron.nulls += 1;
          }
        };
        const answers: {
          attachmentKey: string;
          ms: number;
          before: RendererDiagnostics;
          after: RendererDiagnostics;
          outcome: {
            kind: string;
            provenance?: string;
            bytes?: number;
            sha256?: string;
          };
        }[] = [];
        let ms = 0;
        for (const [index, excerpt] of excerpts.entries()) {
          const before = (() => {
            const snapshot =
              zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
            return {
              loads: snapshot.loads,
              phase: snapshot.phase,
              jobActive: snapshot.jobActive,
              fileOpen: snapshot.fileOpen,
              documentOpen: snapshot.documentOpen,
              renderTaskActive: snapshot.renderTaskActive,
            };
          })();
          const requestStarted = performance.now();
          const outcome = await zotlit.services.bridge.runPromise(
            service.resolve(request(excerpt, index)),
          );
          const settled = performance.now() - requestStarted;
          const after = (() => {
            const snapshot =
              zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
            return {
              loads: snapshot.loads,
              phase: snapshot.phase,
              jobActive: snapshot.jobActive,
              fileOpen: snapshot.fileOpen,
              documentOpen: snapshot.documentOpen,
              renderTaskActive: snapshot.renderTaskActive,
            };
          })();
          await observeMemory();
          ms += settled;
          answers.push({
            attachmentKey: excerpt.attachmentKey,
            ms: settled,
            before,
            after,
            outcome:
              outcome.kind === "available"
                ? {
                    kind: outcome.kind,
                    provenance: outcome.provenance,
                    bytes: outcome.bytes.length,
                    sha256: require("crypto")
                      .createHash("sha256")
                      .update(outcome.bytes)
                      .digest("hex"),
                  }
                : { kind: outcome.kind },
          });
        }
        const flatten = (entry: (typeof answers)[number]) => ({
          attachmentKey: entry.attachmentKey,
          ms: entry.ms,
          ...entry.outcome,
          loads: {
            borrowed: entry.after.loads.borrowed - entry.before.loads.borrowed,
            detached: entry.after.loads.detached - entry.before.loads.detached,
            fileOpens:
              entry.after.loads.fileOpens - entry.before.loads.fileOpens,
            documentLoads:
              entry.after.loads.documentLoads -
              entry.before.loads.documentLoads,
          },
        });
        return { ms, requests: answers.map(flatten), memory };
      },
      { excerpts },
      {
        timeoutMs: 300000,
      },
    );

  await obRun(
    vaultId,
    async ({ zotlit }) => {
      const services = zotlit.services;
      await services.bridge.runPromise(services.noteIndex.whenIndexed);
      await services.bridge.runPromise(services.excerptImage.clear);
    },
    undefined,
    {
      timeoutMs: 300000,
    },
  );
  const cold = await measurePass();
  const warm = await measurePass();
  const batch: MultiPdfBatch = {
    coldMs: cold.ms,
    warmMs: warm.ms,
    cold: cold.requests,
    warm: warm.requests,
    memory: {
      samples: cold.memory.samples + warm.memory.samples,
      node: {
        rss: Math.max(cold.memory.node.rss, warm.memory.node.rss),
        heapUsed: Math.max(
          cold.memory.node.heapUsed,
          warm.memory.node.heapUsed,
        ),
        heapTotal: Math.max(
          cold.memory.node.heapTotal,
          warm.memory.node.heapTotal,
        ),
      },
      electron: {
        answers: cold.memory.electron.answers + warm.memory.electron.answers,
        nulls: cold.memory.electron.nulls + warm.memory.electron.nulls,
        private: Math.max(
          cold.memory.electron.private,
          warm.memory.electron.private,
        ),
      },
    },
    excerpts: excerpts.map(({ attachmentKey, pdfPath }) => ({
      attachmentKey,
      pdfPath,
    })),
  };
  console.info(
    "Multi-PDF excerpt batch evidence",
    JSON.stringify(batch, null, 2),
  );

  expect(pdfs.size).toBeGreaterThan(1);
  expect(batch.excerpts).toHaveLength(excerpts.length);
  const coldLoads: Loads = {
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  };
  for (const { loads } of batch.cold)
    for (const kind of Object.keys(coldLoads) as (keyof Loads)[])
      coldLoads[kind] += loads[kind];
  for (const [index, entry] of batch.cold.entries()) {
    expect(
      entry,
      `cold request ${index} of the multi-PDF batch must render its own PDF`,
    ).toMatchObject({
      kind: "available",
      provenance: "rendered",
      loads: { borrowed: 0, detached: 1 },
    });
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
  expect(coldLoads).toEqual({
    borrowed: 0,
    detached: excerpts.length,
    fileOpens: excerpts.length,
    documentLoads: excerpts.length,
  });
  for (const [index, entry] of batch.warm.entries()) {
    expect(entry).toMatchObject({
      provenance: "cache",
      sha256: batch.cold[index]!.sha256,
      loads: { borrowed: 0, detached: 0, fileOpens: 0, documentLoads: 0 },
    });
  }
  expect(batch.warmMs).toBeLessThan(batch.coldMs);
  expect(batch.coldMs).toBeLessThan(60_000);
  expect(batch.memory.samples).toBe(2 * excerpts.length);
  expect(batch.memory.node.rss).toBeGreaterThan(0);
}

export async function verifySavedEditDisplay(
  vaultId: string,
  context: { skip: (note?: string) => void },
): Promise<void> {
  const card = await obRun(
    vaultId,
    async ({ zotlit }, { attachmentKey, targetKey }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      const list = await bridge.runPromise(repository.read(attachmentKey));
      const record =
        list?.annotations?.find((annotation) => annotation.key === targetKey) ??
        null;
      const capability = bridge.runSync(
        repository.capabilityFor(attachmentKey),
      );
      return {
        capability:
          capability.kind === "cooldown"
            ? {
                kind: capability.kind,
                retryAfter: String(capability.retryAfter.toJSON()),
              }
            : capability,
        record: record && { color: record.color, comment: record.comment },
      };
    },
    { attachmentKey: attachment.key, targetKey: target.key },
  );
  if (card.capability.kind !== "writable") {
    context.skip(
      `a confirmed write needs a writable Attachment; this one is ${JSON.stringify(card.capability)}`,
    );
    return;
  }
  expect(card.record).not.toBeNull();
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL on the later check",
    },
  );
  await obRun(
    vaultId,
    async ({ zotlit }) => {
      await zotlit.services.bridge.runPromise(
        zotlit.services.excerptImage.clear,
      );
    },
    undefined,
  );

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }) => {
          zotlit.services.excerptImage.rendererDiagnostics!.release();
        },
        undefined,
      );
    }),
  );
  cleanup.defer(() => removeUrlProbe(vaultId));
  cleanup.defer(() =>
    cleanupStep(async () => {
      await obRun(
        vaultId,
        async ({ zotlit }, { targetKey, commentText, colorValue }) => {
          const repository = zotlit.services.annotationRepository,
            bridge = zotlit.services.bridge;
          const comment = await bridge.runPromise(
            repository.patchComment(targetKey, commentText),
          );
          if (comment.kind !== "idle")
            throw new Error("The saved comment was not restored");
          const color = await bridge.runPromise(
            repository.patchColor(targetKey, colorValue),
          );
          if (color.kind !== "idle")
            throw new Error("The saved colour was not restored");
        },
        {
          targetKey: target.key,
          commentText: card.record!.comment ?? "",
          colorValue: card.record!.color ?? editedColor,
        },
      );
    }),
  );
  await installUrlProbe(vaultId);
  const before = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(before.src).toMatch(/^blob:/);
  const staleSnapshot = await obRun(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const request = requestFor(targetKey);
      helpers.scratch.__zotlitExcerptStale = request;
      return {
        version: request.annotation.version ?? null,
        color: request.annotation.color ?? null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(staleSnapshot.color).toBe(card.record!.color);
  expect(
    staleSnapshot.version,
    "the Fixture Annotations must carry a version for saved order to be an order",
  ).not.toBeNull();
  const beforePixels = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(beforePixels?.pixels).toMatch(/^[0-9a-f]{64}$/);

  expect(
    await obRun(
      vaultId,
      async ({ zotlit }) => {
        zotlit.services.excerptImage.rendererDiagnostics!.hold(
          "page-rendering",
        );
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  const saved = await obRun(
    vaultId,
    async ({ zotlit }, { targetKey, editedColor }) => {
      const outcome = await zotlit.services.bridge.runPromise(
        zotlit.services.annotationRepository.patchColor(targetKey, editedColor),
      );
      return { kind: outcome.kind };
    },
    { targetKey: target.key, editedColor },
  );
  expect(saved).toMatchObject({ kind: "idle" });
  await obRunUntil(
    vaultId,
    async ({ zotlit }) => {
      const state = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return state.phase === "page-rendering" && state.jobActive;
    },
    undefined,
    {
      tries: 80,
      what: "the excerpt renderer to reach the page-rendering phase",
    },
  );
  const held = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(held).toMatchObject({
    src: before.src,
    decoded: true,
    created: before.created,
    revoked: [],
  });

  await obRun(
    vaultId,
    async ({ zotlit }) => {
      zotlit.services.excerptImage.rendererDiagnostics!.release();
    },
    undefined,
  );
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector, beforeImageSrc }) => {
      return (
        !!(() => {
          const image = app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
            .find(Boolean)
            ?.querySelector("img");
          return (
            image &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.src.startsWith("blob:")
          );
        })() &&
        app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img")!.src !== beforeImageSrc
      );
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
      beforeImageSrc: before.src,
    },
    {
      tries: 80,
      what: "the card image to load a new blob URL instead of the one before",
    },
  );
  const edited = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        othersPaint: app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .flatMap((leaf) => [
            ...leaf.view.containerEl.querySelectorAll<HTMLImageElement>(
              `.zt-annot-card:not(${cardSelector}) img`,
            ),
          ])
          .map(({ src }) => src),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  const allocated = edited.created
    .slice(before.created.length)
    .filter((url) => !edited.othersPaint.includes(url));
  const revoked = edited.revoked.slice(before.revoked.length);
  expect(allocated).toContain(edited.src);
  expect(revoked).not.toContain(edited.src);
  expect(revoked).toContain(before.src);
  for (const url of allocated)
    if (url !== edited.src) expect(revoked).toContain(url);
  expect(
    loadsBetween(before.diagnostics, edited.diagnostics).detached +
      loadsBetween(before.diagnostics, edited.diagnostics).borrowed,
  ).toBeGreaterThan(0);
  const editedPixels = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  const resolved = await obRun(
    vaultId,
    async (
      { app, zotlit },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const outcome = await services.bridge.runPromise(
        services.excerptImage.resolve(requestFor(targetKey)),
      );
      return {
        pixels:
          outcome.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(outcome.bytes, outcome.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(editedPixels).toMatchObject({
    width: expect.any(Number),
    height: expect.any(Number),
    pixels: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(editedPixels!.pixels).not.toBe(beforePixels!.pixels);
  expect(editedPixels).toEqual(resolved.pixels);

  const idle = await obRun(
    vaultId,
    async ({ zotlit }, { targetKey, editedComment }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await bridge.runPromise(
        repository.patchComment(targetKey, editedComment),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      return { before, after, outcome: { kind: outcome.kind } };
    },
    { targetKey: target.key, editedComment },
  );
  expect(idle.outcome).toMatchObject({ kind: "idle" });
  await obRunUntil(
    vaultId,
    async ({ app }, { editedComment }) => {
      return app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .some((leaf) =>
          leaf.view.containerEl.textContent?.includes(editedComment),
        );
    },
    { editedComment },
    {
      tries: 80,
      what: "the Annotation View to show the edited comment text",
    },
  );
  const unchanged = await obRun(
    vaultId,
    async ({ app, zotlit, page: helpers }, { cardSelector }) => {
      const state = helpers.scratch.__zotlitExcerptUrlProbe!;
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      return {
        src: image?.src ?? null,
        decoded: !!(image && image.complete && image.naturalWidth > 0),
        created: state.created.slice(),
        revoked: state.revoked.slice(),
        diagnostics: (() => {
          const snapshot =
            zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
          return {
            loads: snapshot.loads,
            phase: snapshot.phase,
            jobActive: snapshot.jobActive,
            fileOpen: snapshot.fileOpen,
            documentOpen: snapshot.documentOpen,
            renderTaskActive: snapshot.renderTaskActive,
          };
        })(),
      };
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(unchanged).toMatchObject({
    src: edited.src,
    created: edited.created,
    revoked: [before.src],
  });
  expect(loadsBetween(idle.before, idle.after)).toEqual({
    borrowed: 0,
    detached: 0,
    fileOpens: 0,
    documentLoads: 0,
  });

  const superseded = await obRun(
    vaultId,
    async (
      { app, zotlit, page: helpers },
      { attachmentKey, libraryId, vaultPath, targetKey },
    ) => {
      const services = zotlit.services;
      const list = await services.bridge.runPromise(
        services.annotationRepository.read(attachmentKey),
      );
      if (!list) throw new Error("The Fixture Attachment has no Annotations");
      const requestFor = (key: string) => {
        const annotation = list.annotations.find(
          (candidate) => candidate.key === key,
        );
        if (!annotation)
          throw new Error(`The Fixture holds no Annotation ${key}`);
        return {
          annotation,
          source: list.source,
          sourceScope: services.bridge.runSync(services.zoteroPref.current)
            .dataDir,
          attachmentKey: annotation.parentKey,
          libraryID: libraryId,
          pdfPath: (app.vault.adapter as FileSystemAdapter).getFullPath(
            vaultPath!,
          ),
          zoteroPngPath: require("path").join(
            services.bridge.runSync(services.zoteroPref.current).dataDir,
            "cache",
            "library",
            `${key}.png`,
          ),
        };
      };
      const request = helpers.scratch.__zotlitExcerptStale;
      if (!request) throw new Error("The pre-edit snapshot is gone");
      const before = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const outcome = await services.bridge.runPromise(
        services.excerptImage.resolve(request),
      );
      const after = (() => {
        const snapshot =
          zotlit.services.excerptImage.rendererDiagnostics!.snapshot();
        return {
          loads: snapshot.loads,
          phase: snapshot.phase,
          jobActive: snapshot.jobActive,
          fileOpen: snapshot.fileOpen,
          documentOpen: snapshot.documentOpen,
          renderTaskActive: snapshot.renderTaskActive,
        };
      })();
      const current = requestFor(targetKey);
      const reference = await services.bridge.runPromise(
        services.excerptImage.stored(current),
      );
      delete helpers.scratch.__zotlitExcerptStale;
      return {
        version: request.annotation.version ?? null,
        currentVersion: current.annotation.version ?? null,
        before,
        after,
        outcome:
          outcome.kind === "available"
            ? {
                kind: outcome.kind,
                provenance: outcome.provenance,
                pixels: await (async (bytes, mimeType) => {
                  const bitmap = await createImageBitmap(
                    new Blob([new Uint8Array(bytes)], { type: mimeType }),
                  );
                  let canvas;
                  try {
                    canvas = document.createElement("canvas");
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const context = canvas.getContext("2d");
                    if (!context)
                      throw new Error("Excerpt pixel canvas unavailable");
                    context.drawImage(bitmap, 0, 0);
                    const data = context.getImageData(
                      0,
                      0,
                      bitmap.width,
                      bitmap.height,
                    ).data;
                    return {
                      width: bitmap.width,
                      height: bitmap.height,
                      pixels: require("crypto")
                        .createHash("sha256")
                        .update(new Uint8Array(data.buffer))
                        .digest("hex"),
                    };
                  } finally {
                    if (canvas) {
                      canvas.width = 0;
                      canvas.height = 0;
                    }
                    bitmap.close();
                  }
                })(outcome.bytes, outcome.format.mimeType),
              }
            : { kind: outcome.kind, pixels: null },
        stored:
          reference && reference.kind === "available"
            ? await (async (bytes, mimeType) => {
                const bitmap = await createImageBitmap(
                  new Blob([new Uint8Array(bytes)], { type: mimeType }),
                );
                let canvas;
                try {
                  canvas = document.createElement("canvas");
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext("2d");
                  if (!context)
                    throw new Error("Excerpt pixel canvas unavailable");
                  context.drawImage(bitmap, 0, 0);
                  const data = context.getImageData(
                    0,
                    0,
                    bitmap.width,
                    bitmap.height,
                  ).data;
                  return {
                    width: bitmap.width,
                    height: bitmap.height,
                    pixels: require("crypto")
                      .createHash("sha256")
                      .update(new Uint8Array(data.buffer))
                      .digest("hex"),
                  };
                } finally {
                  if (canvas) {
                    canvas.width = 0;
                    canvas.height = 0;
                  }
                  bitmap.close();
                }
              })(reference.bytes, reference.format.mimeType)
            : null,
      };
    },
    {
      attachmentKey: attachment.key,
      libraryId: attachment.libraryID,
      vaultPath,
      targetKey: target.key,
    },
  );
  expect(superseded.outcome.kind).toBe("available");
  expect(
    superseded.version!,
    "the captured snapshot must predate the saved edit",
  ).toBeLessThan(superseded.currentVersion!);
  expect(superseded.outcome.pixels!.pixels).toBe(beforePixels!.pixels);
  expect(superseded.outcome.pixels!.pixels).not.toBe(editedPixels!.pixels);
  expect(
    superseded.stored?.pixels,
    "the store's latest reference must still name the saved edit's pixels",
  ).toBe(editedPixels!.pixels);

  expect(
    await obRun(
      vaultId,
      async ({ app }) => {
        const [leaf, ...others] = app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        );
        if (!leaf) throw new Error("The Annotation View is not open");
        const state = leaf.getViewState();
        for (const other of others) other.detach();
        await leaf.setViewState({ type: "empty" });
        await leaf.setViewState(state);
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  await obRunUntil(
    vaultId,
    async ({ app }, { cardSelector }) => {
      return !!(() => {
        const image = app.workspace
          .getLeavesOfType("zotero-annotation-view")
          .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
          .find(Boolean)
          ?.querySelector("img");
        return (
          image &&
          image.complete &&
          image.naturalWidth > 0 &&
          image.src.startsWith("blob:")
        );
      })();
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
    {
      tries: 80,
      what: "the card image to finish loading as a blob URL on the final check",
    },
  );
  const remounted = await obRun(
    vaultId,
    async ({ app }, { cardSelector }) => {
      const image = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) => leaf.view.containerEl.querySelector(cardSelector))
        .find(Boolean)
        ?.querySelector("img");
      if (!image || !image.complete || image.naturalWidth === 0) return null;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Card pixel canvas unavailable");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: require("crypto")
            .createHash("sha256")
            .update(new Uint8Array(data.buffer))
            .digest("hex"),
        };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    {
      cardSelector: `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(target.key)}]`,
    },
  );
  expect(
    remounted?.pixels,
    "a remount paints the saved edit's pixels, never the superseded answer's",
  ).toBe(editedPixels!.pixels);

  console.info("Saved-edit display evidence", {
    annotation: target.key,
    color: { from: card.record!.color, to: editedColor },
    objectUrl: {
      painted: before.src,
      edited: edited.src,
      revoked: edited.revoked,
    },
    pixels: {
      painted: beforePixels!.pixels,
      edited: editedPixels!.pixels,
      superseded: superseded.outcome.pixels!.pixels,
      stored: superseded.stored?.pixels ?? null,
      remounted: remounted?.pixels ?? null,
    },
    superseded: {
      version: superseded.version,
      currentVersion: superseded.currentVersion,
      provenance: superseded.outcome.provenance ?? null,
      loads: loadsBetween(superseded.before, superseded.after),
    },
  });
}
