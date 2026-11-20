import { describe, expect, it } from "vitest";

import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";

import {
  annotationAttachment,
  attachmentAnnotations,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { cli, obRun } from "./obsidian-cli.ts";
import { READER_VIEW_TYPE } from "./reader-handle.ts";
import { reloadWindow } from "./window-reload.ts";

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
  });
});
