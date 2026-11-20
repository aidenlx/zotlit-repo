import type { FileView, WorkspaceLeaf } from "obsidian";
import { describe, expect, it } from "vitest";

import type { LibraryView } from "@zotlit/library-view/desktop/library/view.ts";

import {
  annotationAttachment,
  annotationItem,
  MY_LIBRARY_DOCUMENT,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";
import { raiseWindow } from "./reader-gestures.ts";
import { READER_VIEW_TYPE } from "./reader-handle.ts";

const EXCERPT_PDF = "attachments/excerpt-acceptance/excerpt-rendering.pdf";

interface Registries {
  readonly viewRegistry: { typeByExtension: Record<string, string> };
  readonly embedRegistry: { embedByExtension: Record<string, unknown> };
}

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe("the ZotLit PDF reader", () => {
    it("opens a PDF from ZotLit in the reader at the page its link names", async () => {
      const opened = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const s = zotlit.services;
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          const outcome = await s.bridge.runPromise(
            s.pdfReader.open(file, "#page=2", "tab"),
          );
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = view.reader!;
          await reader.whenReady();
          await reader.settled();
          return {
            outcome,
            viewType: view.getViewType(),
            pageIndex: reader.state.get().pageIndex,
            displayed: view.getDisplayText(),
          };
        },
        { path: EXCERPT_PDF },
        { timeoutMs: 30_000 },
      );
      expect(opened).toEqual({
        outcome: "opened",
        viewType: READER_VIEW_TYPE,
        pageIndex: 1,
        displayed: "excerpt-rendering",
      });
    });

    it("opens an Attachment from ZotLit in the reader while Open all PDFs in the ZotLit reader is off and on, and gives PDFs back to Obsidian when ZotLit turns off with it on (E-18)", async () => {
      const routed = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { path, attachmentKey }) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          const registries = app as unknown as Registries;
          const coreEmbed = registries.embedRegistry.embedByExtension.pdf;
          page.annotationLinkTools(services).restoreLedger(cleanup);
          const { viewType } = page.reader;
          const detachAll = () => {
            for (const type of [viewType, "pdf"])
              for (const leaf of app.workspace.getLeavesOfType(type))
                leaf.detach();
          };
          cleanup.defer(detachAll);
          const annotViews = () =>
            app.workspace.getLeavesOfType("zotero-annotation-view");
          const hadAnnotView = annotViews().length > 0;
          cleanup.defer(() => {
            if (hadAnnotView) return;
            for (const leaf of annotViews()) leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          const opens = async () => {
            await using local = new AsyncDisposableStack();
            const s = services();
            const stale = [viewType, "pdf"].flatMap((type) =>
              app.workspace.getLeavesOfType(type),
            );
            const explorer = local.adopt(app.workspace.getLeaf("tab"), (tab) =>
              tab.detach(),
            );
            for (const leaf of stale) leaf.detach();
            await explorer.openFile(file);
            const explorerType = explorer.view.getViewType();
            const outcome = await s.bridge.runPromise(
              s.targetOpener.open({ kind: "attachment", attachmentKey }, "tab"),
            );
            const opened = app.workspace
              .getLeavesOfType(viewType)
              .find((leaf) => leaf !== explorer);
            if (opened) local.adopt(opened, (tab) => tab.detach());
            const reader = opened ? page.reader.readerOf(opened.view) : null;
            await reader?.whenReady();
            return {
              explorer: explorerType,
              opener: outcome.kind,
              openerView: opened?.view.getViewType() ?? null,
              readerReady: reader?.state.get().status ?? null,
              coreEmbed:
                registries.embedRegistry.embedByExtension.pdf === coreEmbed,
            };
          };

          await page.reader.withTakeover(cleanup, false);
          const off = await opens();

          await page.reader.setTakeover(true);
          const on = await opens();

          await page.reader.setTakeover(false);
          const offAgain = {
            mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
            coreEmbed:
              registries.embedRegistry.embedByExtension.pdf === coreEmbed,
          };
          await page.reader.setTakeover(true);

          const old = services();
          cleanup.defer(async () => {
            if (app.plugins.plugins.zotlit) return;
            await app.plugins.enablePlugin("zotlit");
          });
          await app.plugins.disablePlugin("zotlit");
          await page.until(
            "the old services to close",
            () => old.bridge.closed(),
            10000,
          );
          const disabled = {
            mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
            coreEmbed:
              registries.embedRegistry.embedByExtension.pdf === coreEmbed,
          };
          await app.plugins.enablePlugin("zotlit");
          await page.until(
            "the takeover back on after the re-enable",
            () => page.reader.takeover(),
            20000,
          );
          return { off, on, offAgain, disabled };
        },
        {
          path: annotationAttachment.path!,
          attachmentKey: annotationAttachment.key,
        },
        { timeoutMs: 120_000 },
      );
      expect(routed).toEqual({
        off: {
          explorer: "pdf",
          opener: "reader",
          openerView: READER_VIEW_TYPE,
          readerReady: "ready",
          coreEmbed: true,
        },
        on: {
          explorer: READER_VIEW_TYPE,
          opener: "reader",
          openerView: READER_VIEW_TYPE,
          readerReady: "ready",
          coreEmbed: false,
        },
        offAgain: { mapped: "pdf", coreEmbed: true },
        disabled: { mapped: "pdf", coreEmbed: true },
      });
    }, 180_000);

    it("opens a PDF from the Library View card with the focus in the reader, and in a background tab while Always focus new tabs is off", async () => {
      await raiseWindow(run.vaultId);
      const opened = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { path, paperKey, attachmentKey, libraryDocument },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const s = zotlit.services;
          const vault = app.vault as unknown as {
            getConfig(key: string): unknown;
            setConfig(key: string, value: unknown): void;
          };
          const focusNewTab = vault.getConfig("focusNewTab");
          cleanup.defer(() => vault.setConfig("focusNewTab", focusNewTab));
          const savedDocument = s.bridge.runSync(s.settings.current)[
            "library.document"
          ];
          cleanup.defer(async () => {
            await s.bridge.runPromise(
              s.settings.update({ "library.document": savedDocument }),
            );
          });
          const pdfLeaf = () =>
            app.workspace
              .getLeavesOfType(page.reader.viewType)
              .find((leaf) => (leaf.view as FileView).file?.path === path);
          const annotViews = () =>
            app.workspace.getLeavesOfType("zotero-annotation-view");
          if (annotViews().length === 0) {
            const right = app.workspace.getRightLeaf(false)!;
            await right.setViewState({ type: "zotero-annotation-view" });
            cleanup.defer(() => {
              for (const leaf of annotViews()) leaf.detach();
            });
          }
          const libraries = () =>
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & {
              view: LibraryView;
            })[];
          const hadLibrary = libraries().length > 0;
          cleanup.defer(() => {
            if (hadLibrary) return;
            for (const leaf of libraries()) leaf.detach();
          });
          await s.bridge.runPromise(
            s.settings.update({ "library.document": libraryDocument }),
          );
          await s.bridge.runPromise(s.settings.flush);
          app.commands.executeCommandById("zotlit:open-library-view");
          const library = await page.until(
            "the Library View",
            () => libraries()[0],
            10000,
          );

          vault.setConfig("focusNewTab", true);
          await app.workspace.revealLeaf(library);
          app.workspace.setActiveLeaf(library, { focus: true });
          await library.view.query.settled;
          const el = library.view.contentEl;
          const card = el.querySelector<HTMLElement>("[data-library-card]")!;
          const row = await page.until(
            "the paper's row",
            () =>
              el.querySelector<HTMLElement>(
                `[data-query-item-row="${paperKey}"]`,
              ),
            10000,
          );
          page.press(row, "the paper's row");
          const button = await page.until(
            "the card's Open PDF",
            () =>
              card.checkVisibility() &&
              card.querySelector<HTMLElement>(
                '[data-library-card-action="pdf"]',
              ),
            10000,
          );
          await library.view.card.settled;
          const fromCard = await (async () => {
            await using tab = new AsyncDisposableStack();
            await page.trusted(window).click(button);
            const front = tab.adopt(
              await page.until("the PDF's tab", pdfLeaf, 10000),
              (leaf) => leaf.detach(),
            );
            const reader = await page.until(
              "the reader of the PDF's tab",
              () => page.reader.readerOf(front.view),
              10000,
            );
            await reader.whenReady();
            await reader.settled();
            return {
              active: app.workspace.activeLeaf === front,
              reader: reader.root.contains(document.activeElement),
            };
          })();

          vault.setConfig("focusNewTab", false);
          await app.workspace.revealLeaf(library);
          app.workspace.setActiveLeaf(library, { focus: true });
          const outcome = await s.bridge.runPromise(
            s.targetOpener.open({ kind: "attachment", attachmentKey }, "tab"),
          );
          const background = pdfLeaf();
          if (background) cleanup.adopt(background, (tab) => tab.detach());
          return {
            card: fromCard,
            background: {
              outcome: outcome.kind,
              opened: background !== undefined,
              active: app.workspace.activeLeaf === library,
            },
          };
        },
        {
          path: annotationAttachment.path!,
          paperKey: annotationItem.key,
          attachmentKey: annotationAttachment.key,
          libraryDocument: MY_LIBRARY_DOCUMENT,
        },
        { timeoutMs: 60_000 },
      );
      expect(opened).toEqual({
        card: { active: true, reader: true },
        background: { outcome: "reader", opened: true, active: true },
      });
    });
  });
});
