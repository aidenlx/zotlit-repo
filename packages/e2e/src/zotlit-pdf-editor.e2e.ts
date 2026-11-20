import { join } from "node:path";
import type { WorkspaceLeaf } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  annotationAttachment,
  annotationItem,
  e2eFixture,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";
import { READER_VIEW_TYPE } from "./reader-handle.ts";
import {
  addSharedFileAttachment,
  reindexed,
  SHARED,
} from "./shared-attachment.ts";

const PDF_PATH = annotationAttachment.path!;
const PASSWORD_PDF = "attachments/pdf-reader/password.pdf";
const OUTSIDE_PDF = "attachments/pdf-reader/chrome.pdf";
const PAGE_ONE_MARK = "PUPR5FG5";
const PAGE_TWO_MARK = "FDRFQ7C2";

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe("the annotation editor in the ZotLit PDF reader", () => {
    it("lands an open's Annotation Anchor on a cold, a warm and a deferred leaf, and a plain page link after it selects nothing (E-3)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { path, attachmentKey, pageOneMark, pageTwoMark },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          page.annotationLinkTools(services).restoreLedger(cleanup);
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
          const s = services();
          const file = app.vault.getFileByPath(path)!;
          const anchor = (mark: string) =>
            `#page=3&zt-annotation=${mark}&zt-attachment=${attachmentKey}`;
          const keysOf = (
            subpath: Parameters<
              NonNullable<typeof s.pdfAnnotationEditor.extension.attach>
            >[0]["subpath"],
          ) => ({
            annotation: subpath?.params.get("zt-annotation") ?? null,
            attachment: subpath?.params.get("zt-attachment") ?? null,
          });
          const { extension } = s.pdfAnnotationEditor;
          const nativeAttach = extension.attach!.bind(extension);
          const attached: ReturnType<typeof keysOf>[] = [];
          extension.attach = (context) => {
            attached.push(keysOf(context.subpath));
            return nativeAttach(context);
          };
          cleanup.defer(() => {
            extension.attach = nativeAttach;
          });
          const landed = page.annotationLinkTools(services).landedIn;
          const opened = await s.bridge.runPromise(
            s.pdfReader.open(file, anchor(pageTwoMark), "tab"),
          );
          const leaf = page.reader.views().find((v) => v.file === file)!.leaf;
          const cold = {
            ...(await landed(leaf, pageTwoMark, 2)),
            subpath: attached.splice(0),
          };

          const view = leaf.view;
          s.bridge
            .runSync(s.pdfAnnotationEditor.sessionFor(view))!
            .setSelectedAnnotations([]);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const navigated: ReturnType<typeof keysOf>[] = [];
          const offSubpath = page.reader
            .readerOf(view)!
            .on("subpath", ({ subpath }) => navigated.push(keysOf(subpath)));
          cleanup.defer(offSubpath);
          await s.bridge.runPromise(
            s.pdfReader.open(file, anchor(pageOneMark), false),
          );
          const warm = {
            ...(await landed(leaf, pageOneMark, 1)),
            sameView: leaf.view === view,
            views: page.reader.views().length,
            subpath: navigated.splice(0),
            attached: attached.splice(0),
          };

          s.bridge
            .runSync(s.pdfAnnotationEditor.sessionFor(view))!
            .setSelectedAnnotations([]);
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", false));
          const reader = page.reader.readerOf(leaf.view)!;
          await page.until(
            "the plain page link",
            () => reader.state.get().pageIndex === 1,
            10000,
          );
          await s.bridge.runPromise(
            s.annotationRepository.refresh(attachmentKey),
          );
          const plain = await landed(leaf, null, 2);

          const hidden = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const deferredState = {
            type: page.reader.viewType,
            state: { file: path },
            icon: "lucide-file-text",
            title: file.basename,
          };
          await hidden.setViewState(deferredState, {
            subpath: anchor(pageTwoMark),
          });
          const deferredBefore = hidden.isDeferred;
          await app.workspace.revealLeaf(hidden);
          const deferred = {
            ...(await landed(hidden, pageTwoMark, 2)),
            deferredBefore,
            subpath: attached.splice(0),
          };

          const later = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await later.setViewState(deferredState, {
            subpath: anchor(pageOneMark),
          });
          await later.setViewState(deferredState, { subpath: "#page=2" });
          await app.workspace.revealLeaf(later);
          const laterReader = await page.until(
            "the reader of the later leaf",
            () => page.reader.readerOf(later.view),
            10000,
          );
          await page.until(
            "the plain page link on the later leaf",
            () =>
              laterReader.state.get().status === "ready" &&
              laterReader.state.get().pageIndex === 1,
            10000,
          );
          const plainAfterAnchor = {
            ...(await landed(later, null, 2)),
            subpath: attached.splice(0),
          };
          return { opened, cold, warm, plain, deferred, plainAfterAnchor };
        },
        {
          path: PDF_PATH,
          attachmentKey: annotationAttachment.key,
          pageOneMark: PAGE_ONE_MARK,
          pageTwoMark: PAGE_TWO_MARK,
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        opened: "opened",
        cold: {
          viewType: READER_VIEW_TYPE,
          page: 2,
          selected: [PAGE_TWO_MARK],
          attachment: annotationAttachment.key,
          subpath: [
            {
              annotation: PAGE_TWO_MARK,
              attachment: annotationAttachment.key,
            },
          ],
        },
        warm: {
          viewType: READER_VIEW_TYPE,
          page: 1,
          selected: [PAGE_ONE_MARK],
          attachment: annotationAttachment.key,
          sameView: true,
          views: 1,
          subpath: [
            {
              annotation: PAGE_ONE_MARK,
              attachment: annotationAttachment.key,
            },
          ],
          attached: [],
        },
        plain: {
          viewType: READER_VIEW_TYPE,
          page: 2,
          selected: [],
          attachment: annotationAttachment.key,
        },
        deferred: {
          viewType: READER_VIEW_TYPE,
          page: 2,
          selected: [PAGE_TWO_MARK],
          attachment: annotationAttachment.key,
          deferredBefore: true,
          subpath: [
            {
              annotation: PAGE_TWO_MARK,
              attachment: annotationAttachment.key,
            },
          ],
        },
        plainAfterAnchor: {
          viewType: READER_VIEW_TYPE,
          page: 2,
          selected: [],
          attachment: annotationAttachment.key,
          subpath: [{ annotation: null, attachment: null }],
        },
      });
    }, 180_000);

    it.each([
      ["on", true],
      ["off", false],
    ] as const)(
      "lands a vault link with an Annotation Anchor while Open all PDFs is %s, and rebinds to the other Attachment of the file a later link names (E-4)",
      async (_, takeover) => {
        await using cleanup = new AsyncDisposableStack();
        cleanup.defer(async () => {
          await reindexed("unresolved");
        });
        cleanup.use(
          addSharedFileAttachment(e2eFixture.databasePath, PAGE_ONE_MARK),
        );
        expect(await reindexed("resolved")).toBe(annotationAttachment.key);
        const outcome = await obRun(
          run.vaultId,
          async (
            { app, zotlit, page },
            { path, pageTwoMark, sharedAttachment, sharedAnnotation, takeover },
          ) => {
            await using cleanup = new AsyncDisposableStack();
            const services = () => zotlit.services;
            const tools = page.annotationLinkTools(services);
            tools.restoreLedger(cleanup);
            const s = services();
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
            await page.reader.withTakeover(cleanup, takeover);
            const selectedIn = async (
              leaf: WorkspaceLeaf,
              mark: string,
              pageNumber: number,
            ) => ({
              ...(await tools.landedIn(leaf, mark, pageNumber)),
              binding: s.bridge.runSync(
                s.pdfAnnotationEditor.bindingFor(leaf.view),
              )!,
            });
            await app.workspace.openLinkText(
              `${path}#page=2&zt-annotation=${pageTwoMark}`,
              "",
              "tab",
            );
            const leaf = cleanup.adopt(
              app.workspace.getLeavesOfType(page.reader.viewType)[0]!,
              (tab) => tab.detach(),
            );
            const { binding: first, ...linked } = await selectedIn(
              leaf,
              pageTwoMark,
              2,
            );
            app.workspace.setActiveLeaf(leaf, { focus: true });
            await app.workspace.openLinkText(
              `${path}#page=1&zt-attachment=${sharedAttachment}&zt-annotation=${sharedAnnotation}`,
              "",
              false,
            );
            const { binding: second, ...renamed } = await selectedIn(
              leaf,
              sharedAnnotation,
              1,
            );
            const leaves = app.workspace.getLeavesOfType(
              page.reader.viewType,
            ).length;
            await s.bridge.runPromise(
              s.pdfReader.open(
                app.vault.getFileByPath(path)!,
                `#page=1&zt-attachment=${sharedAttachment}&zt-annotation=${sharedAnnotation}`,
                "tab",
              ),
            );
            const coldLeaf = cleanup.adopt(
              app.workspace
                .getLeavesOfType(page.reader.viewType)
                .find((other) => other !== leaf)!,
              (tab) => tab.detach(),
            );
            const coldFirst = await page.until(
              "the binding of the cold tab",
              () =>
                s.bridge.runSync(
                  s.pdfAnnotationEditor.bindingFor(coldLeaf.view),
                ),
              10000,
            );
            const { binding: coldBinding, ...cold } = await selectedIn(
              coldLeaf,
              sharedAnnotation,
              1,
            );
            return {
              linked,
              renamed: { ...renamed, rebound: second !== first },
              leaves,
              cold: { ...cold, rebound: coldBinding !== coldFirst },
            };
          },
          {
            path: PDF_PATH,
            pageTwoMark: PAGE_TWO_MARK,
            sharedAttachment: SHARED.attachmentKey,
            sharedAnnotation: SHARED.annotationKey,
            takeover,
          },
          { timeoutMs: 120_000 },
        );
        expect(outcome).toEqual({
          linked: {
            viewType: READER_VIEW_TYPE,
            page: 2,
            selected: [PAGE_TWO_MARK],
            attachment: annotationAttachment.key,
          },
          renamed: {
            viewType: READER_VIEW_TYPE,
            page: 1,
            selected: [SHARED.annotationKey],
            attachment: SHARED.attachmentKey,
            rebound: true,
          },
          leaves: 1,
          cold: {
            viewType: READER_VIEW_TYPE,
            page: 1,
            selected: [SHARED.annotationKey],
            attachment: SHARED.attachmentKey,
            rebound: false,
          },
        });
      },
      180_000,
    );

    it("keeps a plain page link in Obsidian's own PDF view while Open all PDFs is off, and moves a tab of that view to the ZotLit reader for a link with an Annotation or Attachment Anchor (E-4)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { path, pageTwoMark, attachmentKey }) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          const tools = page.annotationLinkTools(services);
          tools.restoreLedger(cleanup);
          const closeAll = async () => {
            for (const type of ["pdf", page.reader.viewType])
              for (const leaf of app.workspace.getLeavesOfType(type))
                await leaf.setViewState({ type: "empty" });
          };
          cleanup.defer(closeAll);
          await closeAll();
          await page.reader.withTakeover(cleanup, false);
          const { landedIn: landed } = tools;
          await app.workspace.openLinkText(`${path}#page=2`, "", "tab");
          const nativeLeaf = cleanup.adopt(
            await page.until(
              "Obsidian's own PDF view of the plain link",
              () =>
                app.workspace
                  .getLeavesOfType("pdf")
                  .find((leaf) => leaf.getViewState().state?.file === path),
              10000,
            ),
            (tab) => tab.detach(),
          );
          const plain = {
            viewType: nativeLeaf.view.getViewType(),
            readers: page.reader.views().length,
          };
          app.workspace.setActiveLeaf(nativeLeaf, { focus: true });
          await app.workspace.openLinkText(
            `${path}#page=3&zt-annotation=${pageTwoMark}`,
            "",
            false,
          );
          const moved = {
            sameLeaf:
              app.workspace.getLeavesOfType(page.reader.viewType)[0] ===
              nativeLeaf,
            ...(await landed(nativeLeaf, pageTwoMark, 2)),
          };
          app.workspace.setActiveLeaf(nativeLeaf, { focus: true });
          await app.workspace.openLinkText(`${path}#page=1`, "", false);
          const stays = {
            viewType: nativeLeaf.view.getViewType(),
            page:
              nativeLeaf.view.getViewType() === page.reader.viewType
                ? (await landed(nativeLeaf, null, 1)).page
                : null,
          };
          await app.workspace.openLinkText(
            `${path}#page=1&zt-attachment=${attachmentKey}`,
            "",
            "tab",
          );
          const attachmentLeaf = cleanup.adopt(
            await page.until(
              "the ZotLit reader of the Attachment link",
              () =>
                app.workspace
                  .getLeavesOfType(page.reader.viewType)
                  .find((leaf) => leaf !== nativeLeaf),
              10000,
            ),
            (tab) => tab.detach(),
          );
          const landing = await landed(attachmentLeaf, null, 1);
          const attachmentReader = page.reader.readerOf(attachmentLeaf.view)!;
          const toolbar = await page.until(
            "the Creation Toolbar of the Attachment link",
            () =>
              attachmentReader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ),
            10000,
          );
          const attachmentOnly = { ...landing, tools: toolbar.isConnected };
          return {
            plain,
            moved,
            stays,
            attachmentOnly,
            nativeLeaves: app.workspace.getLeavesOfType("pdf").length,
          };
        },
        {
          path: PDF_PATH,
          pageTwoMark: PAGE_TWO_MARK,
          attachmentKey: annotationAttachment.key,
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        plain: { viewType: "pdf", readers: 0 },
        moved: {
          sameLeaf: true,
          viewType: READER_VIEW_TYPE,
          page: 2,
          selected: [PAGE_TWO_MARK],
          attachment: annotationAttachment.key,
        },
        stays: { viewType: READER_VIEW_TYPE, page: 1 },
        attachmentOnly: {
          viewType: READER_VIEW_TYPE,
          page: 1,
          selected: [],
          attachment: annotationAttachment.key,
          tools: true,
        },
        nativeLeaves: 0,
      });
    }, 180_000);

    it("asks for a password, keeps the Creation Toolbar and the page through a reload, keeps the marks in a pop-out window and loads a background tab when it shows (E-14)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async (
          { app, zotlit, page },
          { path, passwordPath, outsidePath, pageTwoMark },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const services = () => zotlit.services;
          page.annotationLinkTools(services).restoreLedger(cleanup);
          const s = services();
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
          const viewOf = (file: import("obsidian").TFile) =>
            page.until(
              `the reader view of ${file.path}`,
              () =>
                page.reader.views().find((v) => v.file === file && v.reader),
              10000,
            );
          const markOn = (
            reader: import("@zotlit/pdf-reader").PdfReader,
            pageIndex: number,
            key: string,
          ) =>
            page.until(
              `the mark ${key} on page ${pageIndex + 1}`,
              () =>
                reader
                  .pageAt(pageIndex)
                  ?.div.querySelector(
                    `[data-zotero-annotation-key="${key}"]`,
                  ) ?? null,
              10000,
            );

          const passwordFile = app.vault.getFileByPath(passwordPath)!;
          await s.bridge.runPromise(s.pdfReader.open(passwordFile, "", "tab"));
          const locked = await viewOf(passwordFile);
          const lockedReader = locked.reader!;
          await page.until(
            "the password prompt",
            () =>
              lockedReader.state.get().status === "password" &&
              lockedReader.root.querySelector("[data-zpr-part='password']"),
            10000,
          );
          const boundBeforeRead =
            s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(locked)) !== null;
          lockedReader.root.querySelector<HTMLInputElement>(
            "[data-zpr-part='password-input']",
          )!.value = "zotlit";
          lockedReader.root
            .querySelector<HTMLButtonElement>(
              "[data-zpr-part='password-open']",
            )!
            .click();
          const unlocked = (await lockedReader.whenReady()) !== null;
          const creationToolbarIn = (
            reader: import("@zotlit/pdf-reader").PdfReader,
          ) =>
            reader.root.querySelector(
              '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
            ) !== null;
          const password = {
            boundBeforeRead,
            unlocked,
            status: lockedReader.state.get().status,
            tools: creationToolbarIn(lockedReader),
          };
          await locked.leaf.setViewState({ type: "empty" });

          const outside = app.vault.getFileByPath(outsidePath)!;
          await s.bridge.runPromise(s.pdfReader.open(outside, "", "tab"));
          const outsideView = await viewOf(outside);
          await outsideView.reader!.whenReady();
          const outsideBinding = await page.until(
            "the binding of the PDF outside Zotero",
            () =>
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(outsideView)),
            10000,
          );
          await outsideBinding.refreshed;
          const unknown = {
            attachment: outsideBinding.attachment.kind,
            tools: creationToolbarIn(outsideView.reader!),
          };
          await outsideView.leaf.setViewState({ type: "empty" });

          const file = app.vault.getFileByPath(path)!;
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
          const view = await viewOf(file);
          const reader = view.reader!;
          await reader.whenReady();
          const binding = await page.until(
            "the binding",
            () => s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)),
            10000,
          );
          await binding.refreshed;
          const toolbar = await page.until(
            "the Creation Toolbar",
            () =>
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ),
            10000,
          );
          await markOn(reader, 1, pageTwoMark);
          const readerToolbar = reader.root.querySelector<HTMLElement>(
            '[data-zpr-part="toolbar"]',
          )!;
          const groups = [...readerToolbar.children].filter(
            (child) => child.childNodes.length > 0,
          );
          const widest = Math.max(
            toolbar.getBoundingClientRect().width,
            ...groups.map((child) => child.getBoundingClientRect().width),
          );
          reader.root.style.width = `${Math.ceil(widest) + 32}px`;
          const narrow = {
            overflows: readerToolbar.scrollWidth > readerToolbar.clientWidth,
            toolsOnLaterRow:
              toolbar.getBoundingClientRect().top >
              groups[0]!.getBoundingClientRect().top,
          };
          reader.root.style.removeProperty("width");
          await reader.settled();
          const documentBefore = reader.document.get();
          await app.vault.modifyBinary(file, await app.vault.readBinary(file));
          await page.until(
            "the reloaded document",
            () =>
              reader.document.get() !== null &&
              reader.document.get() !== documentBefore &&
              reader.state.get().status === "ready",
            15000,
          );
          await reader.settled();
          await markOn(reader, 1, pageTwoMark);
          const reload = {
            page: reader.state.get().pageIndex + 1,
            sameToolbar:
              toolbar.isConnected &&
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ) === toolbar,
            sameBinding:
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) ===
              binding,
          };

          app.workspace.moveLeafToPopout(view.leaf);
          const popout = await page.until(
            "the reader in a pop-out window",
            () => {
              const { win } = view.containerEl;
              return win === window ? null : win;
            },
            10000,
          );
          await reader.whenReady();
          const moved = await markOn(reader, 1, pageTwoMark);
          const popoutRead = {
            inPopout: moved.ownerDocument === popout.document,
            sameBinding:
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) ===
              binding,
            fingerprint:
              reader.document.get()?.fingerprint ===
              documentBefore?.fingerprint,
          };
          view.leaf.detach();

          const front = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.setViewState({ type: "empty" }),
          );
          await front.openFile(app.vault.getMarkdownFiles()[0]!);
          const background = cleanup.adopt(
            app.workspace.getLeaf("tab"),
            (tab) => tab.detach(),
          );
          app.workspace.setActiveLeaf(front, { focus: true });
          await background.setViewState({
            type: page.reader.viewType,
            state: { file: path },
          });
          const hiddenView = await viewOf(file);
          const hiddenReader = hiddenView.reader!;
          const hiddenBinding = await page.until(
            "the binding of the background tab",
            () =>
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(hiddenView)),
            10000,
          );
          await hiddenBinding.refreshed;
          const intersecting = await new Promise<boolean>((resolve) => {
            const observer = new IntersectionObserver((entries) => {
              observer.disconnect();
              resolve(entries.some((entry) => entry.isIntersecting));
            });
            observer.observe(hiddenReader.root);
          });
          const beforeShown = {
            shown: background.view.containerEl.isShown(),
            intersecting,
            status: hiddenReader.state.get().status,
            document: hiddenReader.document.get() !== null,
          };
          await app.workspace.revealLeaf(background);
          await hiddenReader.whenReady();
          await hiddenBinding.refreshed;
          await page.until(
            "a mark on the shown background tab",
            () =>
              hiddenReader
                .renderedPages()
                .some((p) =>
                  p.div.querySelector("[data-zotero-annotation-key]"),
                ),
            10000,
          );
          return {
            password,
            unknown,
            narrow,
            reload,
            popout: popoutRead,
            background: { beforeShown, shown: true },
          };
        },
        {
          path: PDF_PATH,
          passwordPath: PASSWORD_PDF,
          outsidePath: OUTSIDE_PDF,
          pageTwoMark: PAGE_TWO_MARK,
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
        password: {
          boundBeforeRead: true,
          unlocked: true,
          status: "ready",
          tools: false,
        },
        unknown: { attachment: "unresolved", tools: false },
        narrow: { overflows: false, toolsOnLaterRow: true },
        reload: { page: 2, sameToolbar: true, sameBinding: true },
        popout: { inPopout: true, sameBinding: true, fingerprint: true },
        background: {
          beforeShown: {
            shown: false,
            intersecting: false,
            status: "loading",
            document: false,
          },
          shown: true,
        },
      });
    }, 180_000);

    it("reloads a PDF from Zotero storage outside the vault when the file changes on disk, keeping the page, the Creation Toolbar and the binding (E-14)", async () => {
      const outcome = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { storagePath }) => {
          await using cleanup = new AsyncDisposableStack();
          const s = zotlit.services;
          cleanup.defer(async () => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              await leaf.setViewState({ type: "empty" });
          });
          const file = app.vault.getFileByPath(`file:${storagePath}`)!;
          await s.bridge.runPromise(s.pdfReader.open(file, "#page=2", "tab"));
          const view = await page.until(
            "the reader of the storage file",
            () => page.reader.views().find((v) => v.file === file && v.reader),
            10000,
          );
          const reader = view.reader!;
          await reader.whenReady();
          await reader.settled();
          const toolbar = await page.until(
            "the Creation Toolbar",
            () =>
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ),
            10000,
          );
          const binding = s.bridge.runSync(
            s.pdfAnnotationEditor.bindingFor(view),
          );
          const documentBefore = reader.document.get();
          const fs = require("node:fs") as typeof import("node:fs");
          fs.writeFileSync(storagePath, fs.readFileSync(storagePath));
          await page.until(
            "the reloaded document",
            () =>
              reader.document.get() !== null &&
              reader.document.get() !== documentBefore &&
              reader.state.get().status === "ready",
            15000,
          );
          await reader.settled();
          return {
            external: file.path.startsWith("file:"),
            bound: binding !== null,
            page: reader.state.get().pageIndex + 1,
            sameToolbar:
              toolbar.isConnected &&
              reader.root.querySelector(
                '[data-zpr-part="toolbar"] .zt-pdf-creation-toolbar',
              ) === toolbar,
            sameBinding:
              s.bridge.runSync(s.pdfAnnotationEditor.bindingFor(view)) ===
              binding,
          };
        },
        {
          storagePath: join(
            e2eFixture.dataDir,
            "storage",
            "IANPDF25",
            "ioannidis-2005.pdf",
          ),
        },
        { timeoutMs: 60_000 },
      );
      expect(outcome).toEqual({
        external: true,
        bound: true,
        page: 2,
        sameToolbar: true,
        sameBinding: true,
      });
    }, 120_000);

    it("records no read and logs no error when ZotLit is turned off and on with a reader open, and the leaf comes back into the reader (E-19)", async () => {
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
          path: PDF_PATH,
          itemKey: annotationItem.key,
          attachmentKey: annotationAttachment.key,
          pageTwoMark: PAGE_TWO_MARK,
        },
        { timeoutMs: 120_000 },
      );
      expect(outcome).toEqual({
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
  });
});
