import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";
import { READER_API } from "@zotlit/reader-api";

import {
  annotationAttachment,
  annotationItem,
  attachmentAnnotations,
  e2eVaultPath,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { cli, obRun } from "./obsidian-cli.ts";
import { READER_VIEW_TYPE } from "./reader-handle.ts";
import {
  installReaderProbe,
  PROBE_ID,
  removeReaderProbe,
  writeProbeData,
} from "./reader-probe.ts";
import { reloadWindow } from "./window-reload.ts";

const FALLBACK_NOTICE_KEY = "zotlit-reader-fallback-notices";

const SECOND_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "FDRFQ7C2",
)!;
const SECOND_PAGE_INDEX =
  "pageIndex" in SECOND_PAGE.position ? SECOND_PAGE.position.pageIndex : -1;

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe("ZotLit and ZotLit Reader in one vault", () => {
    it("opens an Annotation from ZotLit in ZotLit Reader on its page, with its mark, the Creation Toolbar and the Annotation View beside the tab (I-1)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { attachmentKey, annotationKey, pageIndex, pageLabel },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          const links = page.annotationLinkTools(services);
          links.restoreLedger(cleanup);
          const known = new Set(page.reader.views());
          cleanup.defer(() => {
            for (const view of page.reader.views())
              if (!known.has(view)) view.leaf.detach();
          });
          const annotViews = () =>
            app.workspace.getLeavesOfType("zotero-annotation-view");
          const hadAnnotView = annotViews().length > 0;
          cleanup.defer(() => {
            if (hadAnnotView) return;
            for (const leaf of annotViews()) leaf.detach();
          });
          const s = services();
          const opened = await s.bridge.runPromise(
            s.targetOpener.open(
              {
                kind: "annotation",
                attachmentKey,
                annotationKey,
                pageIndex,
                pageLabel,
              },
              "tab",
            ),
          );
          const view = await page.until("the Reader's new tab", () =>
            page.reader.views().find((candidate) => !known.has(candidate)),
          );
          const landed = await links.landedIn(
            view.leaf,
            annotationKey,
            pageIndex + 1,
          );
          const reader = page.reader.readerOf(view)!;
          const mark = await page.until(
            "the mark on its page",
            () =>
              reader
                .pageAt(pageIndex)
                ?.div.querySelector(
                  `[data-zotero-annotation-key="${annotationKey}"]`,
                ) != null,
            10000,
          );
          const toolbar = await page.until(
            "the Creation Toolbar",
            () =>
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ) !== null,
            10000,
          );
          const annotView = await page.until(
            "the Annotation View the open brought forward",
            () => app.workspace.getLeavesOfType("zotero-annotation-view")[0],
            10000,
          );
          await app.workspace.revealLeaf(annotView);
          app.workspace.setActiveLeaf(view.leaf, { focus: true });
          const cards = await page.until(
            "the Annotation View beside the tab",
            () =>
              (annotView.view as AnnotationView).contentEl.querySelector(
                `.zt-annot-card[data-zotero-annotation-key="${annotationKey}"]`,
              ) !== null,
            20000,
          );
          return {
            opener: opened.kind,
            viewType: view.getViewType(),
            page: landed.page,
            selected: landed.selected,
            mark,
            toolbar,
            cards,
          };
        },
        {
          attachmentKey: annotationAttachment.key,
          annotationKey: SECOND_PAGE.key,
          pageIndex: SECOND_PAGE_INDEX,
          pageLabel: SECOND_PAGE.pageLabel,
        },
        { timeoutMs: 60_000 },
      );
      expect(outcome).toEqual({
        opener: "reader",
        viewType: READER_VIEW_TYPE,
        page: SECOND_PAGE_INDEX + 1,
        selected: [SECOND_PAGE.key],
        mark: true,
        toolbar: true,
        cards: true,
      });
    }, 120_000);

    it("starts ZotLit Reader before ZotLit and puts ZotLit's layer in the Reader's restored tab after a window reload, with no error (I-2)", async () => {
      const path = annotationAttachment.path!;
      const { saved, known } = await obRun(
        run.vaultId,
        async ({ app, page }) => ({
          saved: JSON.stringify(
            app.loadLocalStorage("zotlit-use-ledger") ?? null,
          ),
          known: page.reader.views().map((view) => view.leaf.id),
        }),
      );
      try {
        const order = await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { path }) => {
            const file = app.vault.getFileByPath(path)!;
            const s = zotlit.services;
            await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
            await page.until("the Reader's tab", () =>
              page.reader.views().some((view) => view.file === file),
            );
            return JSON.parse(
              await app.vault.adapter.read(
                `${app.vault.configDir}/community-plugins.json`,
              ),
            ) as string[];
          },
          { path },
        );
        expect(order.indexOf("zotlit-reader")).toBeLessThan(
          order.indexOf("zotlit"),
        );
        await cli([`vault=${run.vaultId}`, "dev:errors", "clear"]);
        await reloadWindow(run.vaultId);
        const restored = await obRun(
          run.vaultId,
          async ({ zotlit, page }, { path }) => {
            const s = zotlit.services;
            const view = await page.until(
              "the restored Reader tab",
              () =>
                page.reader.views().find((view) => view.file?.path === path),
              20000,
            );
            const reader = await page.until(
              "the restored reader",
              () => page.reader.readerOf(view),
              20000,
            );
            await reader.whenReady();
            const bound = await page.until(
              "ZotLit's binding of the restored tab",
              () =>
                s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) !==
                null,
              20000,
            );
            const toolbar = await page.until(
              "the Creation Toolbar in the restored tab",
              () =>
                reader.root.querySelector(
                  '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
                ) !== null,
              20000,
            );
            return { viewType: view.getViewType(), bound, toolbar };
          },
          { path },
          { timeoutMs: 60_000 },
        );
        expect(restored).toEqual({
          viewType: READER_VIEW_TYPE,
          bound: true,
          toolbar: true,
        });
        expect((await cli([`vault=${run.vaultId}`, "dev:errors"])).trim()).toBe(
          "No errors captured.",
        );
      } finally {
        await obRun(
          run.vaultId,
          async ({ zotlit, page }, { path, known, saved }) => {
            await using cleanup = new AsyncDisposableStack();
            page
              .annotationLinkTools(() => zotlit.services)
              .restoreLedger(cleanup, saved);
            for (const view of page.reader.views())
              if (view.file?.path === path && !known.includes(view.leaf.id))
                view.leaf.detach();
          },
          { path, known, saved },
          { timeoutMs: 60_000 },
        );
      }
    }, 180_000);

    it("starts ZotLit before ZotLit Reader and puts ZotLit's layer in the Reader's restored tab after a window reload, with no error (I-3)", async () => {
      const path = annotationAttachment.path!;
      const { saved, known, original } = await obRun(
        run.vaultId,
        async ({ app, page }) => ({
          saved: JSON.stringify(
            app.loadLocalStorage("zotlit-use-ledger") ?? null,
          ),
          known: page.reader.views().map((view) => view.leaf.id),
          original: await app.vault.adapter.read(
            `${app.vault.configDir}/community-plugins.json`,
          ),
        }),
      );
      const writeOrder = (text: string) =>
        obRun(
          run.vaultId,
          async ({ app }, { text }) => {
            await app.vault.adapter.write(
              `${app.vault.configDir}/community-plugins.json`,
              text,
            );
          },
          { text },
        );
      const ids = JSON.parse(original) as string[];
      const reversed = [
        ...ids.filter((id) => id !== "zotlit-reader"),
        "zotlit-reader",
      ];
      try {
        await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { path }) => {
            const file = app.vault.getFileByPath(path)!;
            const s = zotlit.services;
            await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
            await page.until("the Reader's tab", () =>
              page.reader.views().some((view) => view.file === file),
            );
          },
          { path },
        );
        await writeOrder(JSON.stringify(reversed));
        await cli([`vault=${run.vaultId}`, "dev:errors", "clear"]);
        await reloadWindow(run.vaultId);
        const restored = await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { path }) => {
            const s = zotlit.services;
            const view = await page.until(
              "the restored Reader tab",
              () =>
                page.reader.views().find((view) => view.file?.path === path),
              20000,
            );
            const reader = await page.until(
              "the restored reader",
              () => page.reader.readerOf(view),
              20000,
            );
            await reader.whenReady();
            const bound = await page.until(
              "ZotLit's binding of the restored tab",
              () =>
                s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) !==
                null,
              20000,
            );
            const toolbar = await page.until(
              "the Creation Toolbar in the restored tab",
              () =>
                reader.root.querySelector(
                  '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
                ) !== null,
              20000,
            );
            const loaded = Object.keys(app.plugins.plugins);
            return {
              viewType: view.getViewType(),
              bound,
              toolbar,
              zotlitFirst:
                loaded.indexOf("zotlit") < loaded.indexOf("zotlit-reader"),
            };
          },
          { path },
          { timeoutMs: 60_000 },
        );
        expect(restored).toEqual({
          viewType: READER_VIEW_TYPE,
          bound: true,
          toolbar: true,
          zotlitFirst: true,
        });
        expect((await cli([`vault=${run.vaultId}`, "dev:errors"])).trim()).toBe(
          "No errors captured.",
        );
      } finally {
        await writeOrder(original);
        await reloadWindow(run.vaultId);
        await obRun(
          run.vaultId,
          async ({ zotlit, page }, { path, known, saved }) => {
            await using cleanup = new AsyncDisposableStack();
            page
              .annotationLinkTools(() => zotlit.services)
              .restoreLedger(cleanup, saved);
            for (const view of page.reader.views())
              if (view.file?.path === path && !known.includes(view.leaf.id))
                view.leaf.detach();
          },
          { path, known, saved },
          { timeoutMs: 60_000 },
        );
      }
      expect(
        await obRun(run.vaultId, async ({ app }) => {
          const loaded = Object.keys(app.plugins.plugins);
          return loaded.indexOf("zotlit-reader") < loaded.indexOf("zotlit");
        }),
      ).toBe(true);
    }, 300_000);

    it("puts ZotLit's layer into an open and a new Reader tab when ZotLit Reader is turned on after ZotLit, while a third handshake listener throws (I-4)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const s = zotlit.services;
          page
            .annotationLinkTools(() => zotlit.services)
            .restoreLedger(cleanup);
          const file = app.vault.getFileByPath(path)!;
          const known = new Set(page.reader.views().map((v) => v.leaf));
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType("zotlit-pdf"))
              if (!known.has(leaf)) leaf.detach();
          });
          cleanup.defer(async () => {
            if (!app.plugins.plugins["zotlit-reader"])
              await app.plugins.enablePlugin("zotlit-reader");
          });
          const toolbarIn = (view: import("obsidian").View) =>
            page.reader
              .readerOf(view)
              ?.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ) != null;
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
          const open = await page.until(
            "the Reader's tab",
            () =>
              page.reader
                .views()
                .find((view) => !known.has(view.leaf) && view.file === file),
            20000,
          );
          const leaf = open.leaf;
          await page.until("ZotLit's layer in the open tab", () =>
            toolbarIn(leaf.view),
          );
          const throwing = () => {
            throw new Error("A third handshake listener failed");
          };
          const events: import("obsidian").Events = app.workspace;
          const refs = [
            events.on("zotlit-reader:connect", throwing),
            events.on("zotlit-reader:ready", throwing),
          ];
          cleanup.defer(() => {
            for (const ref of refs) app.workspace.offref(ref);
          });
          await app.plugins.disablePlugin("zotlit-reader");
          const offType = leaf.view.getViewType();
          await app.plugins.enablePlugin("zotlit-reader");
          const reopened = await page.until(
            "the open tab back in ZotLit Reader",
            () => page.reader.readerOf(leaf.view),
            20000,
          );
          await reopened.whenReady();
          const openLayer = await page.until(
            "ZotLit's layer in the open tab after the Reader came back",
            () => toolbarIn(leaf.view),
            20000,
          );
          const openBound =
            s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(leaf.view)) !==
            null;
          const opened = await s.bridge.runPromise(
            s.pdfReader.open(file, "#page=3", "tab"),
          );
          const fresh = await page.until(
            "the new Reader tab",
            () =>
              page.reader
                .views()
                .find(
                  (view) =>
                    !known.has(view.leaf) &&
                    view.leaf !== leaf &&
                    view.file === file,
                ),
            20000,
          );
          const newLayer = await page.until(
            "ZotLit's layer in the new tab",
            () => toolbarIn(fresh),
            20000,
          );
          return {
            offType,
            openType: leaf.view.getViewType(),
            openLayer,
            openBound,
            opened,
            newLayer,
            takeover: page.reader.takeover(),
          };
        },
        { path: annotationAttachment.path! },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        offType: READER_VIEW_TYPE,
        openType: READER_VIEW_TYPE,
        openLayer: true,
        openBound: true,
        opened: "opened",
        newLayer: true,
        takeover: false,
      });
    }, 180_000);

    it("logs no ZotLit error when ZotLit Reader turns off under a ZotLit-bound tab, and opens a later Annotation link in Obsidian's PDF view with the notice (I-5)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          {
            path,
            attachmentKey,
            annotationKey,
            pageIndex,
            pageLabel,
            noticeKey,
            noticeText,
          },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          page.annotationLinkTools(services).restoreLedger(cleanup);
          const savedNotices = app.loadLocalStorage(noticeKey);
          cleanup.defer(() => app.saveLocalStorage(noticeKey, savedNotices));
          app.saveLocalStorage(noticeKey, null);
          const notices = () =>
            [...document.querySelectorAll<HTMLElement>(".notice")].filter(
              (notice) => notice.textContent.includes(noticeText),
            );
          cleanup.defer(() => {
            for (const notice of notices()) notice.click();
          });
          const file = app.vault.getFileByPath(path)!;
          const knownReader = new Set(
            app.workspace.getLeavesOfType("zotlit-pdf"),
          );
          const knownPdf = new Set(app.workspace.getLeavesOfType("pdf"));
          cleanup.defer(() => {
            for (const type of ["zotlit-pdf", "pdf"])
              for (const leaf of app.workspace.getLeavesOfType(type))
                if (!knownReader.has(leaf) && !knownPdf.has(leaf))
                  leaf.detach();
          });
          cleanup.defer(async () => {
            if (!app.plugins.plugins["zotlit-reader"])
              await app.plugins.enablePlugin("zotlit-reader");
          });
          const errors: string[] = [];
          const originalError = console.error;
          cleanup.defer(() => {
            console.error = originalError;
          });
          console.error = (...args: unknown[]) => {
            errors.push(
              args
                .map((value) =>
                  value instanceof Error ? value.message : String(value),
                )
                .join(" "),
            );
            originalError(...args);
          };
          const s = services();
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
          const view = await page.until(
            "the Reader's tab",
            () =>
              page.reader
                .views()
                .find(
                  (candidate) =>
                    !knownReader.has(candidate.leaf) && candidate.file === file,
                ),
            20000,
          );
          await page.until(
            "ZotLit's binding of the tab",
            () =>
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) !== null,
            20000,
          );
          await app.plugins.disablePlugin("zotlit-reader");
          const released = await page.until(
            "ZotLit's bindings to go",
            () => s.bridge.runSync(s.pdfAnnotationEditor.bindings).length === 0,
            10000,
          );
          const opened = await s.bridge.runPromise(
            s.targetOpener.open(
              {
                kind: "annotation",
                attachmentKey,
                annotationKey,
                pageIndex,
                pageLabel,
              },
              "tab",
            ),
          );
          const pdf = await page.until(
            "Obsidian's PDF view",
            () =>
              app.workspace
                .getLeavesOfType("pdf")
                .find(
                  (leaf) =>
                    !knownPdf.has(leaf) &&
                    (leaf.view as import("obsidian").FileView).file === file,
                ),
            20000,
          );
          type BuiltInPdf = {
            viewer?: {
              child?: {
                pdfViewer?: { pdfViewer?: { currentPageNumber: number } };
              };
            };
          };
          const shownPage = await page.until(
            "the page the link names",
            () =>
              (pdf.view as unknown as BuiltInPdf).viewer?.child?.pdfViewer
                ?.pdfViewer?.currentPageNumber ===
              pageIndex + 1,
            20000,
          );
          const notice = await page.until(
            "the notice",
            () => notices().length === 1,
            5000,
          );
          console.error = originalError;
          return { released, opened: opened.kind, shownPage, notice, errors };
        },
        {
          path: annotationAttachment.path!,
          attachmentKey: annotationAttachment.key,
          annotationKey: SECOND_PAGE.key,
          pageIndex: SECOND_PAGE_INDEX,
          pageLabel: SECOND_PAGE.pageLabel,
          noticeKey: FALLBACK_NOTICE_KEY,
          noticeText: run.m.notice_reader_fallback(),
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        released: true,
        opened: "reader",
        shownPage: true,
        notice: true,
        errors: [],
      });
    }, 180_000);

    it("takes ZotLit's layer and toolbar out of an open Reader tab when ZotLit turns off, keeps the tab on its page with no read recorded and no error, and puts the layer back when ZotLit turns on (I-6)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { path, itemKey, attachmentKey, pageTwoMark },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          page.annotationLinkTools(services).restoreLedger(cleanup);
          cleanup.defer(async () => {
            if (!app.plugins.plugins.zotlit)
              await app.plugins.enablePlugin("zotlit");
          });
          cleanup.defer(async () => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              await leaf.setViewState({ type: "empty" });
          });
          for (const leaf of app.workspace.getLeavesOfType(
            page.reader.viewType,
          ))
            await leaf.setViewState({ type: "empty" });
          const bound = async () => {
            const s = services();
            const view = await page.until(
              "the reader view",
              () =>
                page.reader
                  .views()
                  .find((v) => v.file?.path === path && v.reader),
              20000,
            );
            await view.reader!.whenReady();
            const binding = await page.until(
              "the resolved binding",
              () => {
                const found = s.bridge.runSync(
                  s.pdfAnnotationEditor.bindingFor(view),
                );
                return found?.historyAttachment === attachmentKey && found;
              },
              20000,
            );
            await binding.refreshed;
            return view;
          };
          const readOf = () => {
            const s = services();
            const use = s.bridge.runSync(s.useLedger.current)[itemKey];
            return use ? use.instant.epochMilliseconds : null;
          };
          const file = app.vault.getFileByPath(path)!;
          const readAtStart = readOf();
          await services().bridge.runPromise(
            services().pdfReader.open(file, "#page=2", "tab"),
          );
          const before = await bound();
          await before.reader!.settled();
          const readBefore = await page.until(
            "the open read",
            () => {
              const read = readOf();
              return read !== readAtStart && read;
            },
            10000,
          );
          const hidden = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          app.workspace.setActiveLeaf(before.leaf, { focus: true });
          const deferredState = {
            type: page.reader.viewType,
            state: { file: path },
            icon: "lucide-file-text",
            title: file.basename,
          };
          await hidden.setViewState(deferredState);
          const deferredBefore = hidden.isDeferred;
          const errors: string[] = [];
          const originalError = console.error;
          cleanup.defer(() => {
            console.error = originalError;
          });
          console.error = (...args: unknown[]) => {
            errors.push(
              args
                .map((value) =>
                  value instanceof Error ? value.message : String(value),
                )
                .join(" "),
            );
            originalError(...args);
          };
          const old = services();
          const unloadReads: (number | null)[] = [];
          const stopWatch = old.bridge.subscribe(old.useLedger.changes, () => {
            if (old.bridge.closed()) return;
            const use = old.bridge.runSync(old.useLedger.current)[itemKey];
            unloadReads.push(use ? use.instant.epochMilliseconds : null);
          });
          cleanup.defer(stopWatch);
          await app.plugins.disablePlugin("zotlit");
          await page.until(
            "the old services to close",
            () =>
              old.bridge.closed() &&
              old.bridge.runSync(old.pdfAnnotationEditor.bindings).length === 0,
            10000,
          );
          const off = before.reader!;
          const layerGone = await page.until(
            "ZotLit's layer to leave the tab",
            () =>
              off.root.querySelector(".zt-pdf-creation-toolbar") === null &&
              off.container.querySelector("[data-zotero-annotation-key]") ===
                null,
            10000,
          );
          const whileOff = {
            layerGone,
            viewType: before.getViewType(),
            page: off.state.get().pageIndex + 1,
            status: off.state.get().status,
          };
          await app.plugins.enablePlugin("zotlit");
          const after = await bound();
          const painted = await page.until(
            "a mark and the Creation Toolbar after the re-enable",
            () =>
              after.reader!.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ) !== null &&
              after
                .reader!.pageAt(1)
                ?.div.querySelector(
                  `[data-zotero-annotation-key="${pageTwoMark}"]`,
                ) != null,
            10000,
          );
          await after.reader!.settled();
          console.error = originalError;
          const openRecorded = readOf() !== readBefore;
          const deferredAfter = hidden.isDeferred;
          await app.workspace.revealLeaf(hidden);
          const shown = await page.until(
            "the reader of the background tab",
            () => page.reader.readerOf(hidden.view),
            20000,
          );
          await shown.whenReady();
          const backgroundOpenRecorded = await page.until(
            "the open read of the background tab",
            () => readOf() !== readBefore,
            10000,
          );
          return {
            whileOff,
            closeRecorded: unloadReads.some((read) => read !== readBefore),
            openRecorded,
            sameLeaf: after.leaf === before.leaf,
            painted,
            viewType: after.getViewType(),
            errors,
            background: {
              deferredBefore,
              deferredAfter,
              openRecorded: backgroundOpenRecorded,
            },
          };
        },
        {
          path: annotationAttachment.path!,
          itemKey: annotationItem.key,
          attachmentKey: annotationAttachment.key,
          pageTwoMark: SECOND_PAGE.key,
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        whileOff: {
          layerGone: true,
          viewType: READER_VIEW_TYPE,
          page: 2,
          status: "ready",
        },
        closeRecorded: false,
        openRecorded: false,
        sameLeaf: true,
        painted: true,
        viewType: READER_VIEW_TYPE,
        errors: [],
        background: {
          deferredBefore: true,
          deferredAfter: true,
          openRecorded: true,
        },
      });
    }, 180_000);

    it("keeps ZotLit's layer in a Reader tab when the contract probe claims another major and ZotLit Reader refuses it (I-7)", async () => {
      try {
        await installReaderProbe(e2eVaultPath);
        await writeProbeData(e2eVaultPath, { major: READER_API.major + 1 });
        const outcome = await obRun(
          run.vaultId,
          async ({ app, zotlit, page }, { path, probeId }) => {
            await using cleanup = new AsyncDisposableStack();
            const s = zotlit.services;
            page
              .annotationLinkTools(() => zotlit.services)
              .restoreLedger(cleanup);
            const file = app.vault.getFileByPath(path)!;
            const known = new Set(page.reader.views().map((v) => v.leaf));
            cleanup.defer(() => {
              for (const leaf of app.workspace.getLeavesOfType("zotlit-pdf"))
                if (!known.has(leaf)) leaf.detach();
            });
            await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
            const view = await page.until(
              "the Reader's tab",
              () =>
                page.reader
                  .views()
                  .find((v) => !known.has(v.leaf) && v.file === file),
              20000,
            );
            const reader = await page.until("the reader", () =>
              page.reader.readerOf(view),
            );
            await reader.whenReady();
            const binding = await page.until(
              "ZotLit's binding of the tab",
              () => s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)),
              20000,
            );
            const toolbar = await page.until("the Creation Toolbar", () =>
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ),
            );
            cleanup.defer(async () => {
              if (app.plugins.plugins[probeId])
                await app.plugins.disablePlugin(probeId);
            });
            await app.plugins.loadManifests();
            await app.plugins.enablePlugin(probeId);
            const probe = await page.until(
              "the probe's answer",
              () =>
                (
                  app.plugins.plugins[probeId] as
                    | {
                        connection: {
                          state: string;
                          reason?: { supported: readonly number[] };
                        } | null;
                      }
                    | undefined
                )?.connection ?? null,
            );
            const navigated = await reader.navigate({ pageIndex: 2 });
            return {
              probe: probe.state,
              supported:
                probe.state === "refused" ? [...probe.reason!.supported] : null,
              navigated,
              page: reader.state.get().pageIndex + 1,
              sameBinding:
                s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) ===
                binding,
              sameToolbar:
                toolbar.isConnected &&
                reader.root.querySelector(
                  '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
                ) === toolbar,
            };
          },
          { path: annotationAttachment.path!, probeId: PROBE_ID },
          { timeoutMs: 60_000 },
        );
        expect(outcome).toEqual({
          probe: "refused",
          supported: [READER_API.major],
          navigated: "shown",
          page: 3,
          sameBinding: true,
          sameToolbar: true,
        });
      } finally {
        await removeReaderProbe(e2eVaultPath);
      }
    }, 120_000);

    it("keeps a ZotLit Reader tab working while a disable interrupts ZotLit's start-up, and puts ZotLit's layer back on the next enable", async () => {
      const outcome = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          page
            .annotationLinkTools(() => zotlit.services)
            .restoreLedger(cleanup);
          const file = app.vault.getFileByPath(path)!;
          const known = new Set(page.reader.views().map((v) => v.leaf));
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType("zotlit-pdf"))
              if (!known.has(leaf)) leaf.detach();
          });
          cleanup.defer(async () => {
            if (!app.plugins.plugins.zotlit)
              await app.plugins.enablePlugin("zotlit");
          });
          const toolbarOf = (reader: { root: HTMLElement }) =>
            reader.root.querySelector(
              '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
            );
          const s = zotlit.services;
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
          const view = await page.until(
            "the Reader's tab",
            () =>
              page.reader
                .views()
                .find((v) => !known.has(v.leaf) && v.file === file),
            20000,
          );
          const reader = await page.until("the reader", () =>
            page.reader.readerOf(view),
          );
          await reader.whenReady();
          await page.until("ZotLit's layer", () => toolbarOf(reader) !== null);
          const errors: string[] = [];
          const originalError = console.error;
          cleanup.defer(() => {
            console.error = originalError;
          });
          console.error = (...args: unknown[]) => {
            errors.push(
              args
                .map((value) =>
                  value instanceof Error ? value.message : String(value),
                )
                .join(" "),
            );
            originalError(...args);
          };
          const started = () => {
            try {
              return app.plugins.plugins.zotlit?.services !== undefined;
            } catch {
              return false;
            }
          };
          await app.plugins.disablePlugin("zotlit");
          const enabling = app.plugins.enablePlugin("zotlit");
          await page.until(
            "ZotLit's start-up in progress",
            () => app.plugins.plugins.zotlit?._loaded === true && !started(),
            10000,
          );
          await app.plugins.disablePlugin("zotlit");
          await enabling;
          const layerGone = await page.until(
            "ZotLit's layer to leave the tab",
            () =>
              toolbarOf(reader) === null &&
              reader.container.querySelector("[data-zotero-annotation-key]") ===
                null,
            10000,
          );
          const navigated = await reader.navigate({ pageIndex: 2 });
          const whileOff = {
            layerGone,
            navigated,
            page: reader.state.get().pageIndex + 1,
            status: reader.state.get().status,
          };
          await app.plugins.enablePlugin("zotlit");
          const fresh = await page.until(
            "ZotLit's services after the enable",
            () => (started() ? zotlit.services : null),
            20000,
          );
          const bound = await page.until(
            "ZotLit's binding of the tab",
            () =>
              fresh.bridge.runSync(
                fresh.pdfAnnotationEditor.bindingFor(view),
              ) !== null,
            20000,
          );
          const layerBack = await page.until(
            "ZotLit's layer back in the tab",
            () => toolbarOf(reader) !== null,
            20000,
          );
          console.error = originalError;
          return {
            whileOff,
            sameReader: page.reader.readerOf(view) === reader,
            bound,
            layerBack,
            errors,
          };
        },
        { path: annotationAttachment.path! },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        whileOff: {
          layerGone: true,
          navigated: "shown",
          page: 3,
          status: "ready",
        },
        sameReader: true,
        bound: true,
        layerBack: true,
        errors: [],
      });
    }, 180_000);
  });

  describe("ZotLit alone", () => {
    beforeAll(async () => {
      await obRun(run.vaultId, async ({ app }) => {
        await app.plugins.disablePlugin("zotlit-reader");
      });
    });

    afterAll(async () => {
      const after = await obRun(run.vaultId, async ({ app, page }) => {
        if (!app.plugins.plugins["zotlit-reader"])
          await app.plugins.enablePlugin("zotlit-reader");
        await page.until(
          "ZotLit Reader's api",
          () => app.plugins.plugins["zotlit-reader"]?.api !== undefined,
        );
        const order = JSON.parse(
          await app.vault.adapter.read(
            `${app.vault.configDir}/community-plugins.json`,
          ),
        ) as string[];
        return {
          takeover: page.reader.takeover(),
          readerFirst: order.indexOf("zotlit-reader") < order.indexOf("zotlit"),
        };
      });
      expect(after).toEqual({ takeover: false, readerFirst: true });
    });

    const openInBuiltInView = (
      target:
        | { kind: "attachment"; attachmentKey: string }
        | {
            kind: "annotation";
            attachmentKey: string;
            annotationKey: string;
            pageIndex: number;
            pageLabel: string | null;
          },
      expectedPage: number | null,
    ) =>
      obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { target, expectedPage, path, noticeKey, noticeText },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          page.annotationLinkTools(services).restoreLedger(cleanup);
          const savedNotices = app.loadLocalStorage(noticeKey);
          cleanup.defer(() => app.saveLocalStorage(noticeKey, savedNotices));
          app.saveLocalStorage(noticeKey, null);
          const notices = () =>
            [...document.querySelectorAll<HTMLElement>(".notice")].filter(
              (notice) => notice.textContent.includes(noticeText),
            );
          cleanup.defer(() => {
            for (const notice of notices()) notice.click();
          });
          const file = app.vault.getFileByPath(path)!;
          const known = new Set(app.workspace.getLeavesOfType("pdf"));
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType("pdf"))
              if (!known.has(leaf)) leaf.detach();
          });
          const errors: string[] = [];
          const originalError = console.error;
          cleanup.defer(() => {
            console.error = originalError;
          });
          console.error = (...args: unknown[]) => {
            errors.push(
              args
                .map((value) =>
                  value instanceof Error ? value.message : String(value),
                )
                .join(" "),
            );
            originalError(...args);
          };
          type BuiltInPdf = {
            viewer?: {
              child?: {
                pdfViewer?: { pdfViewer?: { currentPageNumber: number } };
              };
            };
          };
          const open = async () => {
            const s = services();
            const opened = await s.bridge.runPromise(
              s.targetOpener.open(target, "tab"),
            );
            const leaf = await page.until(
              "Obsidian's PDF view",
              () =>
                app.workspace
                  .getLeavesOfType("pdf")
                  .find(
                    (candidate) =>
                      !known.has(candidate) &&
                      (candidate.view as import("obsidian").FileView).file ===
                        file,
                  ),
              20000,
            );
            known.add(leaf);
            const shownPage =
              expectedPage === null ||
              (await page.until(
                "the page the open names",
                () =>
                  (leaf.view as unknown as BuiltInPdf).viewer?.child?.pdfViewer
                    ?.pdfViewer?.currentPageNumber === expectedPage,
                20000,
              ));
            return { opened: opened.kind, shownPage };
          };
          const first = await open();
          const firstNotice = await page.until(
            "the notice",
            () => notices().length === 1,
            5000,
          );
          for (const notice of notices()) notice.click();
          await page.until("the notice to hide", () => notices().length === 0);
          const second = await open();
          await new Promise((resolve) => setTimeout(resolve, 500));
          const secondNotices = notices().length;
          console.error = originalError;
          return {
            readerLoaded: app.plugins.plugins["zotlit-reader"] !== undefined,
            first,
            firstNotice,
            second,
            secondNotices,
            remembered: app.loadLocalStorage(noticeKey),
            errors,
          };
        },
        {
          target,
          expectedPage,
          path: annotationAttachment.path!,
          noticeKey: FALLBACK_NOTICE_KEY,
          noticeText: run.m.notice_reader_fallback(),
        },
        { timeoutMs: 120_000 },
      );

    it("opens an Attachment from ZotLit in Obsidian's PDF view with no ZotLit Reader, and tells the researcher once how to get the annotation tools (Z-1)", async () => {
      expect(
        await openInBuiltInView(
          { kind: "attachment", attachmentKey: annotationAttachment.key },
          null,
        ),
      ).toEqual({
        readerLoaded: false,
        first: { opened: "reader", shownPage: true },
        firstNotice: true,
        second: { opened: "reader", shownPage: true },
        secondNotices: 0,
        remembered: ["turn-on"],
        errors: [],
      });
    }, 180_000);

    it("opens an Annotation link from ZotLit in Obsidian's PDF view at the Annotation's page with no ZotLit Reader (Z-2)", async () => {
      expect(
        await openInBuiltInView(
          {
            kind: "annotation",
            attachmentKey: annotationAttachment.key,
            annotationKey: SECOND_PAGE.key,
            pageIndex: SECOND_PAGE_INDEX,
            pageLabel: SECOND_PAGE.pageLabel ?? null,
          },
          SECOND_PAGE_INDEX + 1,
        ),
      ).toEqual({
        readerLoaded: false,
        first: { opened: "reader", shownPage: true },
        firstNotice: true,
        second: { opened: "reader", shownPage: true },
        secondNotices: 0,
        remembered: ["turn-on"],
        errors: [],
      });
    }, 180_000);
  });
});
