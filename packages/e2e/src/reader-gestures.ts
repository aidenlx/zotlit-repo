import { expect } from "vitest";

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { BackgroundWindow } from "./page-notes-types.ts";

export async function armToolOnFirstPage(
  vaultId: string,
  {
    attachmentPath,
    tool,
    at,
  }: { attachmentPath: string; tool: string; at?: readonly [number, number] },
): Promise<void> {
  await raiseWindow(vaultId);
  await obRunUntil(
    vaultId,
    ({ page }, { attachmentPath }) => {
      const opened = page.pdfReader(attachmentPath);
      if (!opened) return false;
      void opened.reader.navigate({ pageIndex: 0 });
      return !!opened.reader
        .pageAt(0)
        ?.div.querySelector(".zt-pdf-annotation-overlay");
    },
    { attachmentPath },
    { what: "PDF first page overlay" },
  );
  if (at) {
    await obRun(
      vaultId,
      ({ page }, { attachmentPath, at }) => {
        const view = page.pdfView(attachmentPath)!;
        const point = page.clientOfFirstPage(view, at[0], at[1]);
        page.pageContainer(view).scrollTop += point.y - innerHeight / 2;
      },
      { attachmentPath, at },
    );
    await obRunUntil(
      vaultId,
      ({ page }, { attachmentPath, at }) => {
        const view = page.pdfView(attachmentPath)!;
        const point = page.clientOfFirstPage(view, at[0], at[1]);
        return (
          Math.abs(point.y - innerHeight / 2) < innerHeight / 4 &&
          view
            .reader!.pageAt(0)!
            .div.contains(document.elementFromPoint(point.x, point.y))
        );
      },
      { attachmentPath, at },
      { what: "PDF point centered" },
    );
  }
  expect(
    await obRun(
      vaultId,
      ({ page }, { attachmentPath, tool }) => {
        const button = page.toolButton(page.pdfView(attachmentPath)!, tool)!;
        if (button.getAttribute("aria-pressed") !== "true")
          page.press(button, `tool ${tool}`);
        return button.getAttribute("aria-pressed");
      },
      { attachmentPath, tool },
    ),
  ).toBe("true");
}

export async function disarmTool(
  vaultId: string,
  { attachmentPath, tool }: { attachmentPath: string; tool: string },
): Promise<void> {
  await obRun(
    vaultId,
    ({ page }, { attachmentPath, tool }) => {
      const button = page.toolButton(page.pdfView(attachmentPath)!, tool);
      if (button?.getAttribute("aria-pressed") === "true") button.click();
    },
    { attachmentPath, tool },
  );
}

export async function settledGesture(
  vaultId: string,
  attachmentPath: string,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ zotlit }, { attachmentPath }) => {
      await zotlit.services.bridge
        .runSync(zotlit.services.pdfAnnotationEditor.bindings)
        .find((candidate) => candidate.filePath === attachmentPath)!.gestured;
    },
    { attachmentPath },
  );
}

export async function reopenPdfView(
  vaultId: string,
  attachmentPath: string,
): Promise<void> {
  expect(
    await obRun(
      vaultId,
      async ({ page }, { attachmentPath }) => {
        const view = page.pdfView(attachmentPath)!;
        const file = view.file!;
        await view.leaf.setViewState({ type: "empty" });
        await view.leaf.setViewState({
          type: page.reader.viewType,
          state: { file: file.path },
          active: true,
        });
        return "reopened";
      },
      { attachmentPath },
    ),
  ).toBe("reopened");
}

export async function openPdfWithAnnotationView(
  vaultId: string,
  {
    attachmentPath,
    cleanup,
  }: {
    attachmentPath: string;
    cleanup: AsyncDisposableStack;
  },
): Promise<void> {
  const layout = await obRun(
    vaultId,
    async ({ app }) => {
      return JSON.stringify(app.workspace.getLayout());
    },
    undefined,
  );
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async ({ app }, { layout }) => {
        await app.workspace.changeLayout(JSON.parse(layout));
      },
      { layout },
    );
  });
  await obRun(
    vaultId,
    async ({ app, zotlit }, { attachmentPath }) => {
      const file = app.vault.getFileByPath(attachmentPath)!;
      const s = zotlit.services;
      await s.bridge.runPromise(s.pdfReader.open(file, "", "tab"));
    },
    { attachmentPath },
  );
  await obRunUntil(
    vaultId,
    async ({ zotlit }, { attachmentPath }) => {
      return !!zotlit.services.bridge
        .runSync(zotlit.services.pdfAnnotationEditor.bindings)
        .find((b) => b.filePath === attachmentPath)?.session;
    },
    { attachmentPath },
    {
      what: "the PDF annotation editor binding for the attachment to open a session",
    },
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:open-annot-view");
    },
    undefined,
  );
  await obRun(
    vaultId,
    async ({ app }) => {
      app.commands.executeCommandById("zotlit:annot-view-follow-active-tab");
    },
    undefined,
  );
}

export async function raiseWindow(vaultId: string): Promise<void> {
  await obRunUntil(
    vaultId,
    ({ page }) => {
      const electronWindow = (
        require("@electron/remote") as {
          getCurrentWindow(): BackgroundWindow & {
            isVisible(): boolean;
          };
        }
      ).getCurrentWindow();
      if (!electronWindow.isVisible() || electronWindow.isMinimized())
        page.showBehind(electronWindow);
      return document.visibilityState;
    },
    undefined,
    { what: "visible vault window", ready: (state) => state === "visible" },
  );
}

export async function expectEditorKeepsSelections(
  vaultId: string,
): Promise<void> {
  const nativeMenus = await obRun(vaultId, ({ app }) =>
    app.vault.getConfig("nativeMenus"),
  );
  await obRun(vaultId, ({ app }) => {
    app.vault.setConfig("nativeMenus", false);
  });
  try {
    const type = () =>
      obRun(vaultId, ({ page }) => {
        page.popupEditor()!.focus();
        document.execCommand("selectAll");
        document.execCommand("insertText", false, "hello world");
      });
    const gesture = async (kind: "double" | "drag" | "context" | "all") => {
      await obRun(
        vaultId,
        ({ page }, { kind }) => {
          const send = (
            type: string,
            { x, y }: { x: number; y: number },
            extra?: PointerEventInit,
          ) => {
            const init = {
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: 1,
              button: 0,
              buttons: 1,
              view: window,
              ...extra,
            };
            document
              .elementFromPoint(x, y)!
              .dispatchEvent(
                type.startsWith("pointer")
                  ? new PointerEvent(type, init)
                  : new MouseEvent(type, init),
              );
          };
          const press = (point: { x: number; y: number }, detail: number) => {
            send("pointerdown", point, { detail });
            send("mousedown", point, { detail });
            send("pointerup", point, { detail, buttons: 0 });
            send("mouseup", point, { detail, buttons: 0 });
            send("click", point, { detail, buttons: 0 });
          };
          const text = [...page.popupEditor()!.querySelectorAll(".cm-line")]
            .flatMap((line) => [...line.childNodes])
            .map((node) => (node.nodeType === 3 ? node : node.firstChild))
            .find((node) => node?.textContent?.includes("hello"))!;
          const at = (from: number, to: number) => {
            const range = document.createRange();
            range.setStart(text, from);
            range.setEnd(text, to);
            const box = range.getBoundingClientRect();
            return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          };
          if (kind === "double") {
            const word = at(1, 2);
            press(word, 1);
            press(word, 2);
            send("dblclick", word, { detail: 2, buttons: 0 });
          }
          if (kind === "drag") {
            const from = at(1, 2),
              to = at(8, 9);
            send("pointerdown", from, { detail: 1 });
            send("mousedown", from, { detail: 1 });
            send("pointermove", to);
            send("mousemove", to);
            send("pointerup", to, { buttons: 0 });
            send("mouseup", to, { buttons: 0 });
            send("click", to, { buttons: 0 });
          }
          if (kind === "context")
            send("contextmenu", at(1, 2), { button: 2, buttons: 2 });
          if (kind === "all") {
            const menu = [
              ...document.querySelectorAll(".menu .menu-item"),
            ].find((item) => item.textContent.trim() === "Select all")!;
            const box = menu.getBoundingClientRect();
            press(
              { x: box.left + box.width / 2, y: box.top + box.height / 2 },
              1,
            );
          }
        },
        { kind },
      );
    };
    const selected = async (text: string) => {
      await obRunUntil(vaultId, () => String(getSelection()), undefined, {
        what: "editor selection",
        ready: (value) => value === text,
      });
      await obRunUntil(vaultId, ({ page }) => !!page.popupEditor(), undefined, {
        what: "popup editor stays open",
      });
    };
    await type();
    await gesture("double");
    await selected("hello");
    await type();
    await gesture("drag");
    await selected("ello wo");
    await type();
    await gesture("context");
    await obRunUntil(
      vaultId,
      () =>
        [...document.querySelectorAll(".menu .menu-item")].some(
          (item) => item.textContent.trim() === "Select all",
        ),
      undefined,
      { what: "Select all menu item" },
    );
    await gesture("all");
    await selected("hello world");
  } finally {
    await obRun(
      vaultId,
      ({ app }, { nativeMenus }) => {
        app.vault.setConfig("nativeMenus", nativeMenus);
      },
      { nativeMenus },
    );
  }
}

export async function recomputedSortIndex(
  vaultId: string,
  { attachmentPath, position }: { attachmentPath: string; position: string },
): Promise<string> {
  return obRun(
    vaultId,
    async ({ zotlit }, { attachmentPath, position }) => {
      const binding = zotlit.services.bridge
        .runSync(zotlit.services.pdfAnnotationEditor.bindings)
        .find((candidate) => candidate.filePath === attachmentPath)!;
      return (await binding.sortIndex(position))!;
    },
    {
      attachmentPath,
      position: JSON.parse(position) as Parameters<
        import("@zotlit/annotations/obsidian/pdf-annotation-editor/service.ts").PdfViewBinding["sortIndex"]
      >[0],
    },
  );
}

export async function watchExcerptPixels(
  vaultId: string,
): Promise<AsyncDisposable & { keys(): Promise<string[]> }> {
  await obRun(
    vaultId,
    async ({ zotlit, page }) => {
      page.scratch.pixelsOff?.();
      page.scratch.pixels = [];
      page.scratch.pixelsOff = zotlit.services.bridge.subscribe(
        zotlit.services.annotationRepository.excerptPixelsChanged,
        ({ record }) => page.scratch.pixels!.push(record.key),
      );
    },
    undefined,
  );
  return {
    async keys() {
      return (await obRun(
        vaultId,
        async ({ page }) => {
          return page.scratch.pixels;
        },
        undefined,
      )) as string[];
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          page.scratch.pixelsOff?.();
          delete page.scratch.pixelsOff;
          delete page.scratch.pixels;
        },
        undefined,
      );
    },
  };
}
