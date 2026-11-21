import type { ProbeData } from "@e2e-fixtures/reader-probe-plugin/main.ts";
import type ReaderProbePlugin from "@e2e-fixtures/reader-probe-plugin/main.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { prepareRunWindow } from "./background-throttling.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type {
  FileExplorerView,
  PagePdfReaderView,
} from "./page-notes-types.ts";
import { raiseWindow } from "./reader-gestures.ts";
import {
  installReaderProbe,
  PROBE_ID,
  PROBE_LAYER,
  removeReaderProbe,
  writeProbeData,
} from "./reader-probe.ts";
import { registerRunVaultGuard } from "./run-vault-guard.ts";
import {
  clearVault,
  e2eVaultDir,
  installPlugins,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-reader-fixture"),
);
const vaultPath = e2eVaultDir(workspaceRoot, "reader-vault");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const reachable = await isObsidianReachable(workspaceRoot);
const READER_ID = "zotlit-reader";
const CHROME_PDF = "attachments/pdf-reader/chrome.pdf";
const PDF_PATH = "attachments/excerpt-acceptance/excerpt-rendering.pdf";
const EMBEDS_NOTE = "pdf-reader-embeds.md";
const THEME_PDF = "pdf-reader-theme.pdf";
const EMBEDS_CANVAS = "pdf-reader-embeds.canvas";
const SELECTION_NOTE = "pdf-reader-selection-links.md";
const SAKIMA_PATH = "attachments/selection-links/sakimas-song.pdf";
const ROUGIER_PATH = "attachments/rougier-2014.pdf";
const MOCK_FORM_PATH = "attachments/selection-links/mock-form.pdf";
const OBSIDIAN_SELECTIONS = [
  {
    path: SAKIMA_PATH,
    subpath: "#page=5&selection=6,9,6,40",
    text: "Sakima was left with his little",
  },
  {
    path: SAKIMA_PATH,
    subpath: "#page=5&selection=2,18,4,14",
    text: "They left home early in the morning",
  },
  {
    path: ROUGIER_PATH,
    subpath: "#page=1&selection=35,0,48,7",
    text: "Scientific visualization is classically defined as the process",
  },
  {
    path: ROUGIER_PATH,
    subpath: "#page=1&selection=140,0,140,26",
    text: "Rule 1: Know Your Audience",
  },
  {
    path: MOCK_FORM_PATH,
    subpath: "#page=1&selection=31,0,38,1",
    text: "示示例文字用于复现表单对象示例文字用于复现示示例文字示",
  },
];
const READER_SELECTIONS = [
  {
    path: SAKIMA_PATH,
    pageIndex: 4,
    text: "They left home early in the morning",
  },
  {
    path: ROUGIER_PATH,
    pageIndex: 0,
    text: "Scientific visualization is classically defined as the process",
  },
];
const PAST_THE_PAGE = {
  path: SAKIMA_PATH,
  subpath: "#page=5&selection=9999,0,9999,4",
  pageIndex: 4,
};
const DISPLAY_ENTRIES = [
  "Fit width",
  "Fit height",
  "Single page",
  "Two-page (odd)",
  "Two-page (even)",
  "Adapt to theme",
];
const squeeze = (text: string) => text.replaceAll(/\s+/g, "");
interface Registries {
  readonly viewRegistry: { typeByExtension: Record<string, string> };
  readonly embedRegistry: { embedByExtension: Record<string, unknown> };
}

describe.skipIf(!reachable)("ZotLit Reader alone", () => {
  let vaultId = "";
  registerRunVaultGuard(() => vaultId, { leftovers: false });

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const plugins = await installPlugins(workspaceRoot, vaultPath, READER_ID);
    const created = await runVaultScript(["open", vaultPath, plugins]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
  }, 300_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  it("starts with no ZotLit and no error, and opens a PDF from the file explorer with text, page labels and zoom (R-1)", async () => {
    const opened = await obRun(
      vaultId,
      async ({ app, page }, { id, path }) => {
        await using cleanup = new AsyncDisposableStack();
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
        cleanup.defer(() => {
          for (const leaf of app.workspace.getLeavesOfType("zotlit-pdf"))
            leaf.detach();
        });
        const servicesOf = () => {
          try {
            return !!app.plugins.plugins[id]?.services;
          } catch {
            return false;
          }
        };
        const firstStart = servicesOf();
        await app.plugins.disablePlugin(id);
        await app.plugins.enablePlugin(id);
        await page.until("ZotLit Reader to start", servicesOf, 20_000);
        const started = {
          firstStart,
          loaded: Object.keys(app.plugins.plugins).sort(),
          zotlitInstalled: "zotlit" in app.plugins.manifests,
          pdfOpensIn: app.viewRegistry.typeByExtension.pdf ?? null,
        };

        const explorer = app.workspace.getLeavesOfType(
          "file-explorer",
        )[0] as import("obsidian").WorkspaceLeaf & { view: FileExplorerView };
        app.workspace.leftSplit.expand();
        await app.workspace.revealLeaf(explorer);
        explorer.view.revealInFolder(app.vault.getFileByPath(path)!);
        const row = await page.until(
          "the PDF's file explorer row",
          () => explorer.view.fileItems[path]?.selfEl,
        );
        row.scrollIntoView({ block: "center", behavior: "instant" });
        await page.stands(row, "the PDF's file explorer row");
        page.press(row, "the PDF's file explorer row");
        const view = await page.until(
          "the PDF in a view",
          () =>
            app.workspace
              .getLeavesOfType("zotlit-pdf")
              .map((leaf) => leaf.view as PagePdfReaderView)
              .find((candidate) => candidate.file?.path === path),
          10_000,
        );
        const reader = await page.until("the reader", () => view.reader);
        await reader.whenReady();
        await reader.whenRendered(0);
        await reader.settled();
        const part = <T extends HTMLElement>(name: string) =>
          reader.root.querySelector<T>(
            `[data-zpr-part="toolbar"] [data-zpr-part="${name}"]`,
          )!;
        const shown = {
          viewType: view.getViewType(),
          pageIndex: reader.state.get().pageIndex,
          text: reader
            .pageAt(0)
            ?.textLayer?.textContent.includes("The fox and the Fox."),
          label: part<HTMLInputElement>("page-input").value,
          count: part("page-count").textContent,
        };

        const before = reader.state.get().scale;
        const repainted = new Promise<void>((resolve) => {
          const off = reader.on("page-rendered", ({ page: drawn }) => {
            if (drawn.pageIndex !== 0) return;
            off();
            resolve();
          });
        });
        page.press(part<HTMLButtonElement>("zoom-in"), "the zoom-in button");
        await page.until(
          "the scale to grow",
          () => reader.state.get().scale > before,
        );
        await repainted;
        await reader.settled();
        const zoomed = {
          grew: reader.state.get().scale > before,
          text: reader
            .pageAt(0)
            ?.textLayer?.textContent.includes("The fox and the Fox."),
        };
        return { started, shown, zoomed, errors };
      },
      { id: READER_ID, path: CHROME_PDF },
      { timeoutMs: 60_000 },
    );
    expect(opened).toEqual({
      started: {
        firstStart: true,
        loaded: ["hot-reload", READER_ID],
        zotlitInstalled: false,
        pdfOpensIn: "zotlit-pdf",
      },
      shown: {
        viewType: "zotlit-pdf",
        pageIndex: 0,
        text: true,
        label: "i",
        count: "(1 of 3)",
      },
      zoomed: { grew: true, text: true },
      errors: [],
    });
  });

  it("pages with the arrow keys in a fit mode, lists its display modes and keeps one reader for a later link", async () => {
    const keyed = await obRun(
      vaultId,
      async ({ app, page }, { path, entries }) => {
        await using cleanup = new AsyncDisposableStack();
        const file = app.vault.getFileByPath(path)!;
        const known = new Set(page.reader.views());
        await page.reader.open(file, { subpath: "#page=2", pane: "tab" });
        const view = await page.until(
          "the PDF in a reader view",
          () =>
            page.reader
              .views()
              .find(
                (candidate): candidate is PagePdfReaderView =>
                  !known.has(candidate) && candidate.file === file,
              ) ?? null,
        );
        cleanup.adopt(view.leaf, (leaf) => leaf.detach());
        const reader = await page.until("the reader", () => view.reader);
        await reader.whenReady();
        await reader.settled();
        app.workspace.setActiveLeaf(view.leaf, { focus: true });
        reader.focus();
        await page.trusted(view.containerEl.win).key("Right");
        await page.until("the next page", () =>
          reader.state.get().pageIndex === 2 ? true : false,
        );
        const { subpath } = view.getEphemeralState();
        const before = page.reader.views().length;
        await page.reader.open(file, { subpath: "#page=5" });
        await page.until("the linked page", () =>
          reader.state.get().pageIndex === 4 ? true : false,
        );
        page.press(
          view.containerEl.querySelector<HTMLElement>(
            '.view-header [aria-label="More options"]',
          ),
          "the reader view's More options",
        );
        await page.menuReady();
        const items = [
          ...view.containerEl.doc.querySelectorAll<HTMLElement>(
            ".menu .menu-item",
          ),
        ];
        const titles = items
          .map((item) => item.textContent)
          .filter((title) => entries.includes(title));
        page.press(
          items.find((item) => item.textContent === "Fit height"),
          "Fit height",
        );
        return {
          subpath: typeof subpath === "string" ? subpath : null,
          sameReader: view.reader === reader,
          newViews: page.reader.views().length - before,
          titles,
          zoom: reader.state.get().zoom,
        };
      },
      { path: PDF_PATH, entries: DISPLAY_ENTRIES },
      { timeoutMs: 30_000 },
    );
    expect(keyed).toEqual({
      subpath: "#page=3",
      sameReader: true,
      newViews: 0,
      titles: DISPLAY_ENTRIES,
      zoom: "page-height",
    });
  });

  it("adapts its pages to the Obsidian theme and repaints them when the theme changes, also in a background tab (R-4)", async () => {
    const themed = await obRun(
      vaultId,
      async ({ app, page }, { path }) => {
        await using cleanup = new AsyncDisposableStack();
        const file = app.vault.getFileByPath(path)!;
        const theme = app.vault.getConfig("theme");
        cleanup.defer(() => app.changeTheme(theme));
        app.changeTheme("moonstone");
        const view = await page.reader.openNew(cleanup, file, {
          subpath: "#page=1",
          pane: "tab",
        });
        const reader = await page.until("the reader", () => view.reader);
        cleanup.defer(() => reader.set({ themed: false }));
        await reader.whenReady();
        await reader.whenRendered(0);
        await reader.settled();
        const lightness = (x: number, y: number) => {
          const target = reader.pageAt(0)!;
          const canvas = target.div.querySelector("canvas")!;
          const [vx = 0, vy = 0] = target.viewport.convertToViewportPoint(x, y);
          const [r = 0, g = 0, b = 0] = canvas
            .getContext("2d")!
            .getImageData(
              Math.round((vx * canvas.width) / target.viewport.width),
              Math.round((vy * canvas.height) / target.viewport.height),
              1,
              1,
            ).data;
          return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        };
        const shot = () => ({
          dark: view.containerEl.doc.body.hasClass("theme-dark"),
          themed: reader.root.hasClass("mod-themed"),
          inverted: reader.root.hasAttribute("data-zpr-inverted"),
          page: lightness(10, 190),
          rectangle: lightness(60, 145),
          picture: lightness(240, 150),
        });
        const plain = shot();
        reader.set({ themed: true });
        await reader.settled();
        const light = shot();
        const repainted = new Promise<void>((resolve) => {
          const off = reader.on("page-rendered", ({ page: painted }) => {
            if (painted.pageIndex !== 0) return;
            off();
            resolve();
          });
        });
        app.changeTheme("obsidian");
        await page.until("the dark theme", () =>
          reader.root.hasAttribute("data-zpr-inverted"),
        );
        await repainted;
        await reader.settled();
        const dark = shot();
        const other = app.workspace.getLeaf("tab");
        cleanup.adopt(other, (leaf) => leaf.detach());
        await other.setViewState({ type: "empty", active: true });
        await page.until(
          "the reader tab in the background",
          () => reader.container.clientHeight === 0,
        );
        app.changeTheme("moonstone");
        await page.until(
          "the light theme",
          () => !reader.root.hasAttribute("data-zpr-inverted"),
        );
        app.workspace.setActiveLeaf(view.leaf);
        await page.until(
          "the reader tab in front",
          () => reader.container.clientHeight > 0,
        );
        const shown = await Promise.race([
          reader.settled().then(() => "settled"),
          new Promise<string>((resolve) => {
            setTimeout(() => resolve("not painted"), 5000);
          }),
        ]);
        const back = { ...shot(), shown };
        return { plain, light, dark, back };
      },
      { path: THEME_PDF },
      { timeoutMs: 30_000 },
    );
    expect(themed.plain).toMatchObject({
      dark: false,
      themed: false,
      inverted: false,
      page: 255,
    });
    expect(themed.light).toMatchObject({
      dark: false,
      themed: true,
      inverted: false,
      rectangle: themed.plain.rectangle,
      picture: themed.plain.picture,
    });
    expect(themed.light.page).toBeGreaterThan(200);
    expect(themed.dark).toMatchObject({
      dark: true,
      themed: true,
      inverted: true,
      picture: themed.plain.picture,
    });
    expect(themed.dark.page).toBeLessThan(80);
    expect(themed.dark.rectangle).toBeGreaterThan(themed.plain.rectangle);
    expect(themed.back).toMatchObject({
      dark: false,
      themed: true,
      inverted: false,
      shown: "settled",
      rectangle: themed.plain.rectangle,
      picture: themed.plain.picture,
    });
    expect(themed.back.page).toBeGreaterThan(200);
  });

  it("reads the standard fonts Obsidian ships through obsidianFetchData", async () => {
    const bytes = await readFile(
      join(
        workspaceRoot,
        "packages/scripts/lib/fixture/assets/pdf-reader/standard-fonts.pdf",
      ),
    );
    const forkFonts = join(workspaceRoot, "packages/pdfjs/dist/standard_fonts");
    const fetched = await obRun(
      vaultId,
      async ({ page }, { pdf }) => {
        await using cleanup = new AsyncDisposableStack();
        const requests: { url: string; ok: boolean; size: number }[] = [];
        const original = window.fetch;
        cleanup.defer(() => {
          window.fetch = original;
        });
        window.fetch = async (input, init) => {
          const response = await original(input, init);
          const url = input instanceof Request ? input.url : input.toString();
          if (url.includes("/lib/pdfjs/")) {
            const size = (await response.clone().arrayBuffer()).byteLength;
            requests.push({ url, ok: response.ok, size });
          }
          return response;
        };
        const document = await page.reader.loadDocument({
          key: "standard-fonts.pdf",
          name: "standard-fonts.pdf",
          read: async () =>
            Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0)),
        });
        cleanup.defer(() => document[Symbol.asyncDispose]());
        const pdfPage = (await document.page(0))!;
        const viewport = pdfPage.getViewport({ scale: 1 });
        const canvas = activeDocument.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await pdfPage.render({ canvas, viewport }).promise;
        return requests;
      },
      { pdf: bytes.toString("base64") },
      { timeoutMs: 30_000 },
    );
    const expected = await Promise.all(
      ["FoxitSymbol.pfb", "FoxitDingbats.pfb"].map(async (name) => ({
        url: `/lib/pdfjs/standard_fonts/${name}`,
        ok: true,
        size: (await readFile(join(forkFonts, name))).byteLength,
      })),
    );
    expect(
      fetched.map(({ url, ok, size }) => ({
        url: url.slice(url.indexOf("/lib/pdfjs/")),
        ok,
        size,
      })),
    ).toEqual(expect.arrayContaining(expected));
  });

  it("highlights the text of a #selection= link made in Obsidian's own PDF view, as that view does (R-2)", async () => {
    const shown = await obRun(
      vaultId,
      async ({ app, page }, { note, links, past }) => {
        await using cleanup = new AsyncDisposableStack();
        cleanup.defer(() => page.reader.setTakeover(true));
        await page.reader.setTakeover(false);
        const written = await app.vault.cachedRead(
          app.vault.getFileByPath(note)!,
        );
        const openInReader = async (
          file: import("obsidian").TFile,
          subpath: string,
        ) => {
          const known = new Set(page.reader.views());
          await page.reader.open(file, { subpath, pane: "tab" });
          const view = await page.until(
            "the PDF in a reader view",
            () =>
              page.reader
                .views()
                .find(
                  (candidate): candidate is PagePdfReaderView =>
                    !known.has(candidate) && candidate.file === file,
                ) ?? null,
          );
          cleanup.adopt(view.leaf, (tab) => tab.detach());
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          return reader;
        };
        const results = [];
        for (const { path, subpath } of links) {
          const file = app.vault.getFileByPath(path)!;
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          await leaf.openFile(file, { eState: { subpath } });
          const obsidian = await page.until(
            `Obsidian's highlight of ${path}${subpath}`,
            () => {
              const marks = [
                ...leaf.view.containerEl.querySelectorAll(
                  ".textLayer .mod-focused",
                ),
              ];
              return marks.length > 0
                ? marks.map((mark) => mark.textContent).join("")
                : null;
            },
            20000,
          );
          const reader = await openInReader(file, subpath);
          const marks = [
            ...reader.container.querySelectorAll('[data-zpr-highlight="text"]'),
          ];
          results.push({
            onPage: written.includes(`[[${path}${subpath}\\|`),
            obsidianView: leaf.view.getViewType(),
            obsidian,
            reader: marks.map((mark) => mark.textContent).join(""),
          });
        }
        const reader = await openInReader(
          app.vault.getFileByPath(past.path)!,
          past.subpath,
        );
        return {
          results,
          past: {
            onPage: written.includes(`[[${past.path}${past.subpath}\\|`),
            pageIndex: reader.state.get().pageIndex,
            marks: reader.container.querySelectorAll(
              '[data-zpr-highlight="text"]',
            ).length,
          },
        };
      },
      { note: SELECTION_NOTE, links: OBSIDIAN_SELECTIONS, past: PAST_THE_PAGE },
      { timeoutMs: 120_000 },
    );
    expect({
      ...shown,
      results: shown.results.map((result) => ({
        ...result,
        obsidian: squeeze(result.obsidian),
        reader: squeeze(result.reader),
      })),
    }).toEqual({
      results: OBSIDIAN_SELECTIONS.map(({ text }) => ({
        onPage: true,
        obsidianView: "pdf",
        obsidian: squeeze(text),
        reader: squeeze(text),
      })),
      past: { onPage: true, pageIndex: PAST_THE_PAGE.pageIndex, marks: 0 },
    });
  });

  it("copies a link to a selection that Obsidian's own PDF view highlights the same way (R-2)", async () => {
    const copied = await obRun(
      vaultId,
      async ({ app, page }, { selections }) => {
        await using cleanup = new AsyncDisposableStack();
        cleanup.defer(() => page.reader.setTakeover(true));
        await page.reader.setTakeover(false);
        const results = [];
        for (const { path, pageIndex, wanted } of selections) {
          const file = app.vault.getFileByPath(path)!;
          const known = new Set(page.reader.views());
          await page.reader.open(file, {
            subpath: `#page=${pageIndex + 1}`,
            pane: "tab",
          });
          const view = await page.until(
            "the PDF in a reader view",
            () =>
              page.reader
                .views()
                .find(
                  (candidate): candidate is PagePdfReaderView =>
                    !known.has(candidate) && candidate.file === file,
                ) ?? null,
          );
          cleanup.adopt(view.leaf, (tab) => tab.detach());
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.whenRendered(pageIndex);
          await reader.settled();
          const layer = reader.pageAt(pageIndex)!.textLayer!;
          const chars: [Text, number][] = [];
          const walker = layer.ownerDocument.createTreeWalker(
            layer,
            NodeFilter.SHOW_TEXT,
          );
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const value = node.textContent ?? "";
            for (let at = 0; at < value.length; at++) {
              if (!/\s/.test(value[at]!)) chars.push([node as Text, at]);
            }
          }
          const start = chars
            .map(([node, at]) => node.data[at])
            .join("")
            .indexOf(wanted);
          const [startNode, startAt] = chars[start]!;
          const [endNode, endAt] = chars[start + wanted.length - 1]!;
          const range = layer.ownerDocument.createRange();
          range.setStart(startNode, startAt);
          range.setEnd(endNode, endAt + 1);
          const selection = layer.ownerDocument.getSelection()!;
          cleanup.defer(() => {
            selection.removeAllRanges();
            layer.ownerDocument.body.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          });
          selection.removeAllRanges();
          selection.addRange(range);
          const selected = selection.toString();
          const span = startNode.parentElement!;
          const box = span.getBoundingClientRect();
          span.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: box.left + 1,
              clientY: box.top + box.height / 2,
              button: 2,
            }),
          );
          const item = await page.until(
            "Copy link to selection",
            () =>
              [
                ...layer.ownerDocument.querySelectorAll<HTMLElement>(
                  ".menu .menu-item",
                ),
              ].find(
                (entry) =>
                  entry.querySelector(".menu-item-title")?.textContent ===
                  "Copy link to selection",
              ) ?? null,
            20000,
          );
          await navigator.clipboard.writeText("");
          page.press(item, "Copy link to selection");
          const link = await page.until("the copied link", () =>
            navigator.clipboard.readText(),
          );
          selection.removeAllRanges();
          const subpath = link.slice(
            link.indexOf("#"),
            link.includes("|") ? link.indexOf("|") : link.indexOf("]]"),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          await leaf.openFile(file, { eState: { subpath } });
          const obsidian = await page.until(
            `Obsidian's highlight of ${path}${subpath}`,
            () => {
              const marks = [
                ...leaf.view.containerEl.querySelectorAll(
                  ".textLayer .mod-focused",
                ),
              ];
              return marks.length > 0
                ? marks.map((mark) => mark.textContent).join("")
                : null;
            },
            20000,
          );
          results.push({
            selected,
            linked: subpath.startsWith(`#page=${pageIndex + 1}&selection=`),
            obsidian,
          });
        }
        return results;
      },
      {
        selections: READER_SELECTIONS.map(({ path, pageIndex, text }) => ({
          path,
          pageIndex,
          wanted: squeeze(text),
        })),
      },
      { timeoutMs: 120_000 },
    );
    expect(
      copied.map((result) => ({
        ...result,
        selected: squeeze(result.selected),
        obsidian: squeeze(result.obsidian),
      })),
    ).toEqual(
      READER_SELECTIONS.map(({ text }) => ({
        selected: squeeze(text),
        linked: true,
        obsidian: squeeze(text),
      })),
    );
  });

  it("opens PDFs, embeds, hover previews and canvas cards in the reader with the takeover on by default (R-3)", async () => {
    const taken = await obRun(
      vaultId,
      async ({ app, page }, { path, note, canvasFile }) => {
        await using cleanup = new AsyncDisposableStack();
        const registries = app as unknown as Registries;
        const opened = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
          tab.detach(),
        );
        await opened.openFile(app.vault.getFileByPath(path)!);
        await page.until("the opened PDF's reader", () =>
          page.reader.readerOf(opened.view),
        );
        const explorer = {
          mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
          opened: opened.view.getViewType(),
        };

        const noteLeaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
          tab.detach(),
        );
        await noteLeaf.setViewState({
          type: "markdown",
          state: { file: note, mode: "preview" },
          active: true,
        });
        const root = noteLeaf.view.containerEl;
        const preview = root.querySelector<HTMLElement>(
          ".markdown-preview-view",
        )!;
        const scrolledTo = <T>(what: string, find: () => T | null) =>
          page.until(
            what,
            () => {
              const found = find();
              if (!found) preview.scrollTop += preview.clientHeight / 2;
              return found;
            },
            10000,
          );
        const shown = async (src: string) => {
          const embed = await scrolledTo(`the embed ${src}`, () =>
            root.querySelector<HTMLElement>(
              `.internal-embed.pdf-embed[src="${src}"]:has(.zpr-root[data-zpr-kind="embed"])`,
            ),
          );
          embed.scrollIntoView({ block: "start", behavior: "instant" });
          await page.until(
            `the text of ${src}`,
            () => embed.querySelector(".textLayer span"),
            10000,
          );
          const toolbar = embed.querySelector<HTMLElement>(
            '[data-zpr-part="toolbar"]',
          )!.offsetHeight;
          const scroller = embed.querySelector<HTMLElement>(
            '[data-zpr-part="scroller"]',
          )!;
          const content = embed.querySelector<HTMLElement>(
            '[data-zpr-part="content"]',
          )!;
          const holds = () =>
            Math.abs(embed.clientHeight - (toolbar + content.offsetHeight)) <=
            1;
          return { embed, toolbar, scroller, content, holds };
        };
        const first = await shown("excerpt-rendering.pdf");
        const firstPage = first.embed.querySelector<HTMLElement>(
          '.page[data-page-number="1"]',
        )!;
        const second = await shown("excerpt-rendering.pdf#page=2");
        const secondPage = second.embed.querySelector<HTMLElement>(
          '.page[data-page-number="2"]',
        )!;
        const third = await shown("excerpt-rendering.pdf#height=300");
        first.embed.scrollIntoView({ block: "start", behavior: "instant" });
        page.press(
          first.embed.querySelector<HTMLElement>(
            '[data-zpr-slot="toolbar-end"] [aria-label="More options"]',
          ),
          "the embed's More options",
        );
        await page.menuReady();
        const menu = [
          ...root.doc.querySelectorAll(".menu .menu-item-title"),
        ].map((title) => title.textContent);
        await page.trusted(root.win).key("Escape");
        const embeds = {
          pageHeight:
            Math.abs(first.content.offsetHeight - firstPage.offsetHeight) <=
              1 && first.holds(),
          interactive:
            first.embed.querySelector(".zpr-root.interactive-child") !== null,
          secondAtPage2:
            Math.abs(
              secondPage.getBoundingClientRect().top -
                second.scroller.getBoundingClientRect().top,
            ) <= 16,
          fixedHeight:
            Math.abs(third.content.offsetHeight - 300) <= 1 && third.holds(),
          menuStartsWithOpen: menu[0] === "Open",
          linkMenu: menu.includes("Open in new tab"),
        };

        const link = await scrolledTo("the link to page 3", () =>
          preview.querySelector<HTMLElement>(
            '.internal-link[data-href="excerpt-rendering.pdf#page=3"]',
          ),
        );
        link.scrollIntoView({ block: "center", behavior: "instant" });
        const box = link.getBoundingClientRect();
        cleanup.defer(() => {
          (
            noteLeaf.view as { hoverPopover?: { hide(): void } | null }
          ).hoverPopover?.hide();
        });
        app.workspace.trigger("hover-link", {
          event: new MouseEvent("mouseover", {
            clientX: box.left + 2,
            clientY: box.top + 2,
            ctrlKey: true,
            metaKey: true,
          }),
          source: "preview",
          hoverParent: noteLeaf.view,
          targetEl: link,
          linktext: "excerpt-rendering.pdf#page=3",
          sourcePath: note,
        });
        const popover = await page.until(
          "the hover preview's reader",
          () =>
            root.doc.querySelector<HTMLElement>(
              '.hover-popover .zpr-root[data-zpr-kind="hover"]',
            ),
          10000,
        );
        await page.until(
          "the hover preview's text",
          () => popover.querySelector(".textLayer span"),
          10000,
        );
        const hover = {
          toolbarHeight: popover.querySelector<HTMLElement>(
            '[data-zpr-part="toolbar"]',
          )!.offsetHeight,
        };

        await noteLeaf.setViewState({
          type: "markdown",
          state: { file: note, mode: "source", source: false },
          active: true,
        });
        const editor = root.querySelector<HTMLElement>(".cm-scroller")!;
        const live = await page.until(
          "the Live Preview embed of #height=300",
          () => {
            const found = root.querySelector<HTMLElement>(
              '.markdown-source-view .pdf-embed.zpr-fit-height[src="excerpt-rendering.pdf#height=300"]',
            );
            if (!found) editor.scrollTop += editor.clientHeight / 2;
            return found;
          },
          10000,
        );
        const liveContent = live.querySelector<HTMLElement>(
          '[data-zpr-part="content"]',
        )!;
        const liveToolbar = await page.until(
          "the Live Preview embed's toolbar",
          () =>
            live.querySelector<HTMLElement>('[data-zpr-part="toolbar"]')
              ?.offsetHeight || null,
        );
        const livePreview = {
          fixedHeight:
            Math.abs(liveContent.offsetHeight - 300) <= 1 &&
            Math.abs(
              live.clientHeight - (liveToolbar + liveContent.offsetHeight),
            ) <= 1,
        };

        const element = cleanup.adopt(root.doc.body.createDiv(), (div) =>
          div.remove(),
        );
        const markdownView = noteLeaf.view as import("obsidian").MarkdownView;
        await (
          markdownView.previewMode
            .constructor as typeof import("obsidian").MarkdownPreviewView
        ).render(
          app,
          "![[excerpt-rendering.pdf#page=2]]",
          element,
          note,
          markdownView,
        );
        const image = await page.until(
          "the static page image",
          () => {
            const found =
              element.querySelector<HTMLImageElement>(".pdf-embed img");
            return found?.complete && found.naturalWidth > 0 ? found : null;
          },
          10000,
        );
        const printedEmbed = image.closest<HTMLElement>(".pdf-embed")!;
        const printed = {
          wide: image.naturalWidth > 1000,
          fitsImage:
            Math.abs(
              printedEmbed.getBoundingClientRect().bottom -
                image.getBoundingClientRect().bottom,
            ) <= 4,
          reader: element.querySelector(".zpr-root") !== null,
        };

        const canvasLeaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
          tab.detach(),
        );
        await canvasLeaf.openFile(app.vault.getFileByPath(canvasFile)!);
        const card = await page.until(
          "the canvas card's reader",
          () =>
            canvasLeaf.view.containerEl.querySelector<HTMLElement>(
              '.canvas-node .zpr-root[data-zpr-kind="canvas"]',
            ),
          10000,
        );
        const span = await page.until(
          "the canvas card's text",
          () => card.querySelector<HTMLElement>(".textLayer span"),
          10000,
        );
        const container = card.closest<HTMLElement>(".canvas-node-container")!;
        let reached = 0;
        const count = () => {
          reached++;
        };
        container.addEventListener("pointerdown", count);
        cleanup.defer(() =>
          container.removeEventListener("pointerdown", count),
        );
        const pointerDown = (target: HTMLElement) =>
          target.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              isPrimary: true,
              button: 0,
              pointerType: "mouse",
            }),
          );
        pointerDown(span);
        const fromText = reached;
        pointerDown(
          card.querySelector<HTMLElement>('[data-zpr-part="scroller"]')!,
        );
        const canvas = { fromText, fromPage: reached - fromText };

        const farFile = "pdf-reader-embeds-far.canvas";
        const far = await app.vault.create(
          farFile,
          JSON.stringify({
            nodes: [-5000, 5000].map((x) => ({
              id: `far-${x}`,
              type: "text",
              text: "far",
              x,
              y: x * 0.6,
              width: 200,
              height: 100,
            })),
            edges: [],
          }),
        );
        cleanup.defer(() => app.vault.delete(far));
        const farLeaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
          tab.detach(),
        );
        await farLeaf.openFile(far);
        interface FarNode {
          getBBox(): unknown;
          contentEl?: HTMLElement;
        }
        interface FarCanvas {
          zoom: number;
          zoomBreakpoint: number;
          nodes: Map<string, FarNode>;
          zoomToBbox(box: unknown): void;
          createFileNode(options: {
            file: import("obsidian").TFile;
            subpath: string;
            pos: { x: number; y: number };
            size: { width: number; height: number };
            save: boolean;
            focus: boolean;
          }): FarNode;
        }
        const farCanvas = await page.until(
          "the far canvas zoomed out",
          () => {
            const found = (farLeaf.view as unknown as { canvas?: FarCanvas })
              .canvas;
            return found &&
              found.nodes.size === 2 &&
              found.zoom < found.zoomBreakpoint
              ? found
              : null;
          },
          10000,
        );
        const farNode = farCanvas.createFileNode({
          file: app.vault.getFileByPath(path)!,
          subpath: "#page=2",
          pos: { x: -240, y: -320 },
          size: { width: 480, height: 640 },
          save: false,
          focus: false,
        });
        const content = await page.until(
          "the far card's content",
          () => farNode.contentEl ?? null,
          10000,
        );
        const detached = !content.isConnected;
        farCanvas.zoomToBbox(farNode.getBBox());
        const farReader = await page.until(
          "the far card's reader",
          () =>
            content.isConnected
              ? content.querySelector<HTMLElement>(".zpr-root")
              : null,
          10000,
        );
        const farKind = { detached, kind: farReader.dataset.zprKind };
        return {
          explorer,
          embeds,
          hover,
          livePreview,
          printed,
          canvas,
          farKind,
        };
      },
      { path: PDF_PATH, note: EMBEDS_NOTE, canvasFile: EMBEDS_CANVAS },
      { timeoutMs: 60_000 },
    );
    expect(taken).toEqual({
      explorer: { mapped: "zotlit-pdf", opened: "zotlit-pdf" },
      embeds: {
        pageHeight: true,
        interactive: true,
        secondAtPage2: true,
        fixedHeight: true,
        menuStartsWithOpen: true,
        linkMenu: true,
      },
      hover: { toolbarHeight: 0 },
      livePreview: { fixedHeight: true },
      printed: { wide: true, fitsImage: true, reader: false },
      canvas: { fromText: 0, fromPage: 1 },
      farKind: { detached: true, kind: "canvas" },
    });
  });

  it("moves an embed's reader with its note into a pop-out window (R-3)", async () => {
    const moved = await obRun(
      vaultId,
      async ({ app, page }, { note }) => {
        await using cleanup = new AsyncDisposableStack();
        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
          tab.detach(),
        );
        await leaf.setViewState({
          type: "markdown",
          state: { file: note, mode: "preview" },
          active: true,
        });
        const preview = leaf.view.containerEl.querySelector<HTMLElement>(
          ".markdown-preview-view",
        )!;
        const root = await page.until(
          "the first embed's reader",
          () => {
            const found = preview.querySelector<HTMLElement>(
              '.internal-embed.pdf-embed[src="excerpt-rendering.pdf"] .zpr-root[data-zpr-kind="embed"]',
            );
            if (!found) preview.scrollTop += preview.clientHeight / 2;
            return found;
          },
          10000,
        );
        app.workspace.moveLeafToPopout(leaf);
        const popout = await page.until(
          "the note in a pop-out window",
          () => {
            const { win } = leaf.view.containerEl;
            return win === window ? null : win;
          },
          10000,
        );
        await page.until(
          "the embed's text in the pop-out window",
          () => root.querySelector(".textLayer span"),
          10000,
        );
        return {
          sameRoot: root.isConnected && root.doc === popout.document,
          toPopout: root.win === popout,
        };
      },
      { note: EMBEDS_NOTE },
      { timeoutMs: 30_000 },
    );
    expect(moved).toEqual({ sameRoot: true, toPopout: true });
  });

  it("turns the takeover off and on through its setting, and gives PDFs, embeds and hover previews back to Obsidian when the Reader is turned off with the takeover on (R-5)", async () => {
    const switched = await obRun(
      vaultId,
      async ({ app, page }, { id, path, note }) => {
        await using cleanup = new AsyncDisposableStack();
        const registries = app as unknown as Registries;
        const readerCreator = registries.embedRegistry.embedByExtension.pdf;
        const file = app.vault.getFileByPath(path)!;
        const openedIn = async () => {
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          await leaf.openFile(file);
          return leaf;
        };
        const embedOf = async () => {
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          await leaf.setViewState({
            type: "markdown",
            state: { file: note, mode: "preview" },
            active: true,
          });
          const preview = leaf.view.containerEl.querySelector<HTMLElement>(
            ".markdown-preview-view",
          )!;
          const embed = await page.until(
            "the first embed, drawn",
            () => {
              const found = preview.querySelector<HTMLElement>(
                '.internal-embed.pdf-embed[src="excerpt-rendering.pdf"]',
              );
              if (!found) preview.scrollTop += preview.clientHeight / 2;
              return found?.querySelector(
                '.zpr-root[data-zpr-kind="embed"], .pdf-container, .pdf-toolbar',
              )
                ? found
                : null;
            },
            10000,
          );
          const link = await page.until("the link to page 3", () => {
            const found = preview.querySelector<HTMLElement>(
              '.internal-link[data-href="excerpt-rendering.pdf#page=3"]',
            );
            if (!found) preview.scrollTop += preview.clientHeight / 2;
            return found;
          });
          link.scrollIntoView({ block: "center", behavior: "instant" });
          const box = link.getBoundingClientRect();
          const popovers = new Set(
            leaf.view.containerEl.doc.querySelectorAll(".hover-popover"),
          );
          app.workspace.trigger("hover-link", {
            event: new MouseEvent("mouseover", {
              clientX: box.left + 2,
              clientY: box.top + 2,
              ctrlKey: true,
              metaKey: true,
            }),
            source: "preview",
            hoverParent: leaf.view,
            targetEl: link,
            linktext: "excerpt-rendering.pdf#page=3",
            sourcePath: note,
          });
          const popover = await page.until(
            "the hover preview's PDF",
            () =>
              [
                ...leaf.view.containerEl.doc.querySelectorAll<HTMLElement>(
                  ".hover-popover",
                ),
              ].find(
                (found) =>
                  !popovers.has(found) &&
                  found.querySelector(
                    '.zpr-root[data-zpr-kind="hover"], .pdf-container, .pdf-toolbar',
                  ),
              ) ?? null,
            10000,
          );
          const hover = popover.querySelector(".zpr-root") !== null;
          (
            leaf.view as { hoverPopover?: { hide(): void } | null }
          ).hoverPopover?.hide();
          return {
            embed: embed.querySelector(".zpr-root") !== null,
            hover,
          };
        };
        const servicesOf = () => {
          try {
            return !!app.plugins.plugins[id]?.services;
          } catch {
            return false;
          }
        };

        cleanup.defer(() => page.reader.setTakeover(true));
        await page.reader.setTakeover(false);
        const obsidianCreator = registries.embedRegistry.embedByExtension.pdf;
        const off = {
          mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
          embedGiven: obsidianCreator !== readerCreator,
          opened: (await openedIn()).view.getViewType(),
          ...(await embedOf()),
        };

        await page.reader.setTakeover(true);
        const on = {
          mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
          embedTaken:
            registries.embedRegistry.embedByExtension.pdf !== obsidianCreator,
          opened: (await openedIn()).view.getViewType(),
          ...(await embedOf()),
        };

        const readerLeaf = await openedIn();
        const reader = await page.until(
          "the reader",
          () => (readerLeaf.view as PagePdfReaderView).reader,
        );
        await reader.whenReady();
        cleanup.defer(async () => {
          if (servicesOf()) return;
          await app.plugins.enablePlugin(id);
          await page.until("ZotLit Reader to start again", servicesOf, 20_000);
        });
        await app.plugins.disablePlugin(id);
        const unloaded = {
          mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
          sameEmbed:
            registries.embedRegistry.embedByExtension.pdf === obsidianCreator,
          readerGone: !reader.root.isConnected,
          readerDisposed: reader.pageAt(0) === null,
          opened: (await openedIn()).view.getViewType(),
          ...(await embedOf()),
        };

        await app.plugins.enablePlugin(id);
        await page.until("ZotLit Reader to start again", servicesOf, 20_000);
        await page.until(
          "the takeover after the restart",
          () => registries.viewRegistry.typeByExtension.pdf === "zotlit-pdf",
        );
        const restarted = {
          mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
          embedTaken:
            registries.embedRegistry.embedByExtension.pdf !== obsidianCreator,
          opened: (await openedIn()).view.getViewType(),
          ...(await embedOf()),
        };
        return { off, on, unloaded, restarted };
      },
      { id: READER_ID, path: PDF_PATH, note: EMBEDS_NOTE },
      { timeoutMs: 90_000 },
    );
    expect(switched).toEqual({
      off: {
        mapped: "pdf",
        embedGiven: true,
        opened: "pdf",
        embed: false,
        hover: false,
      },
      on: {
        mapped: "zotlit-pdf",
        embedTaken: true,
        opened: "zotlit-pdf",
        embed: true,
        hover: true,
      },
      unloaded: {
        mapped: "pdf",
        sameEmbed: true,
        readerGone: true,
        readerDisposed: true,
        opened: "pdf",
        embed: false,
        hover: false,
      },
      restarted: {
        mapped: "zotlit-pdf",
        embedTaken: true,
        opened: "zotlit-pdf",
        embed: true,
        hover: true,
      },
    });
  });

  describe("the Reader's view, its toolbar, sidebar, find, input, links, reading position, theme variables, embeds and fonts", () => {
    registerRunVaultGuard(() => vaultId);

    it("keeps the focus that moves elsewhere while a PDF opened with focus still loads", async () => {
      const focus = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const field = cleanup.adopt(
            document.body.createEl("input", { type: "text" }),
            (el) => el.remove(),
          );
          const open = async (move: boolean) => {
            const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
              tab.detach(),
            );
            await leaf.setViewState({
              type: page.reader.viewType,
              state: { file: path },
              active: true,
            });
            if (move) field.focus();
            const reader = await page.until(
              "the reader of the new tab",
              () => page.reader.readerOf(leaf.view),
              10000,
            );
            await reader.whenReady();
            await reader.settled();
            return {
              field: document.activeElement === field,
              reader: reader.root.contains(document.activeElement),
            };
          };
          return { moved: await open(true), stayed: await open(false) };
        },
        { path: PDF_PATH },
        { timeoutMs: 60_000 },
      );
      expect(focus).toEqual({
        moved: { field: true, reader: false },
        stayed: { field: false, reader: true },
      });
    });

    it("works its toolbar: sidebar toggle and menu, zoom limits, display menu and page input with page labels (E-2)", async () => {
      const toolbar = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          const bar = reader.root.querySelector<HTMLElement>(
            '[data-zpr-part="toolbar"]',
          )!;
          const part = <T extends HTMLElement = HTMLButtonElement>(
            name: string,
          ) => bar.querySelector<T>(`[data-zpr-part="${name}"]`)!;
          const menuTitles = async () => {
            await page.menuReady();
            return [...activeDocument.querySelectorAll(".menu .menu-item")].map(
              (item) =>
                item.querySelector(".menu-item-title")?.textContent ?? "",
            );
          };
          const choose = (title: string) =>
            page.press(
              [
                ...activeDocument.querySelectorAll<HTMLElement>(
                  ".menu .menu-item",
                ),
              ].find(
                (item) =>
                  item.querySelector(".menu-item-title")?.textContent === title,
              ),
              `the menu item ${title}`,
            );
          const sidebar = () =>
            reader.root.querySelector<HTMLElement>('[data-zpr-part="sidebar"]');
          const shown = (element: HTMLElement | null) =>
            element !== null &&
            element.ownerDocument.defaultView!.getComputedStyle(element)
              .display !== "none";

          page.press(part("sidebar-toggle"), "the sidebar toggle");
          await page.until(
            "the sidebar to open",
            () => reader.state.get().sidebar.open && shown(sidebar()),
          );
          const toggledOpen = {
            open: reader.state.get().sidebar.open,
            pressed: part("sidebar-toggle").getAttribute("aria-pressed"),
          };
          page.press(part("sidebar-toggle"), "the sidebar toggle");
          await page.until(
            "the sidebar to close",
            () => !reader.state.get().sidebar.open && !shown(sidebar()),
          );
          page.press(part("sidebar-menu"), "the sidebar menu");
          const sidebarMenu = await menuTitles();
          choose("Table of contents");
          await page.until(
            "the outline panel",
            () =>
              reader.state.get().sidebar.open &&
              reader.state.get().sidebar.panel === "outline",
          );
          const outline = shown(
            reader.root.querySelector<HTMLElement>('[data-zpr-part="outline"]'),
          );

          const pressUntilOff = async (name: string) => {
            const button = part(name);
            for (let presses = 0; presses < 80 && !button.disabled; presses++) {
              const scale = reader.state.get().scale;
              page.press(button, name);
              await page.until(
                `the scale to move from ${scale}`,
                () => reader.state.get().scale !== scale,
              );
            }
            await reader.settled();
            return { scale: reader.state.get().scale, off: button.disabled };
          };
          const zoomedOut = await pressUntilOff("zoom-out");
          const zoomedIn = await pressUntilOff("zoom-in");

          page.press(part("display-menu"), "the display menu");
          const displayMenu = await menuTitles();
          await page.trusted(view.containerEl.win).key("Escape");
          await page.until(
            "the display menu to close",
            () => activeDocument.querySelectorAll(".menu").length === 0,
          );
          const display: Record<string, string | number | boolean> = {};
          for (const [title, read] of [
            ["Fit width", () => reader.state.get().zoom],
            ["Fit height", () => reader.state.get().zoom],
            ["Two-page (odd)", () => reader.state.get().spread],
            ["Two-page (even)", () => reader.state.get().spread],
            ["Single page", () => reader.state.get().spread],
            [
              "Adapt to theme",
              () => reader.root.classList.contains("mod-themed"),
            ],
          ] as const) {
            page.press(part("display-menu"), "the display menu");
            await page.menuReady();
            choose(title);
            await reader.settled();
            display[title] = read();
          }
          page.press(part("display-menu"), "the display menu");
          await page.menuReady();
          choose("Adapt to theme");
          await reader.settled();

          const trigger = part("display-menu");
          const menus = () => activeDocument.querySelectorAll(".menu").length;
          const toggle: { menus: number; active: boolean }[] = [];
          for (let press = 0; press < 3; press++) {
            await page.trusted(view.containerEl.win).click(trigger);
            await new Promise((resolve) => setTimeout(resolve, 300));
            await page.until(
              `the display menu after press ${press + 1}`,
              () => menus() > 0 === (press !== 1),
            );
            toggle.push({
              menus: menus(),
              active: trigger.classList.contains("has-active-menu"),
            });
          }
          await page.trusted(view.containerEl.win).key("Escape");
          await page.until("the display menu to close", () => menus() === 0);

          const input = () => part<HTMLInputElement>("page-input");
          const count = () => part("page-count").textContent;
          const enter = async (value: string) => {
            const element = input();
            element.focus();
            element.value = value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            await reader.settled();
            element.blur();
          };
          const labelled = {
            type: input().type,
            value: input().value,
            count: count(),
          };
          await enter("1");
          const byLabel = {
            pageIndex: reader.state.get().pageIndex,
            value: input().value,
            count: count(),
          };
          page.press(part("display-menu"), "the display menu");
          await page.menuReady();
          choose("Show page labels");
          await page.until("the number input", () => input().type === "number");
          await enter("3");
          const byNumber = {
            pageIndex: reader.state.get().pageIndex,
            value: input().value,
            count: count(),
          };
          return {
            toggledOpen,
            sidebarMenu,
            outline,
            zoomedOut,
            zoomedIn,
            displayMenu,
            display,
            toggle,
            labelled,
            byLabel,
            byNumber,
          };
        },
        { path: "attachments/pdf-reader/chrome.pdf" },
        { timeoutMs: 60_000 },
      );
      expect(toolbar).toEqual({
        toggledOpen: { open: true, pressed: "true" },
        sidebarMenu: [
          "Thumbnails",
          "Table of contents",
          "Reveal page in table of contents",
        ],
        outline: true,
        zoomedOut: { scale: 0.1, off: true },
        zoomedIn: { scale: 10, off: true },
        displayMenu: [
          "Fit width",
          "Fit height",
          "Single page",
          "Two-page (odd)",
          "Two-page (even)",
          "Adapt to theme",
          "Show page labels",
        ],
        display: {
          "Fit width": "page-width",
          "Fit height": "page-height",
          "Two-page (odd)": "odd",
          "Two-page (even)": "even",
          "Single page": "none",
          "Adapt to theme": true,
        },
        toggle: [
          { menus: 1, active: true },
          { menus: 0, active: false },
          { menus: 1, active: true },
        ],
        labelled: { type: "text", value: "i", count: "(1 of 3)" },
        byLabel: { pageIndex: 1, value: "1", count: "(2 of 3)" },
        byNumber: { pageIndex: 2, value: "3", count: "of 3" },
      });
    });

    it("shows thumbnails and the outline in its sidebar, copies their links and resizes (E-5)", async () => {
      const sidebar = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          const { win } = view.containerEl;
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const zoom = (
            require("electron") as { webFrame: { getZoomFactor(): number } }
          ).webFrame.getZoomFactor();
          const at = (x: number, y: number) => ({
            x: Math.round(x * zoom),
            y: Math.round(y * zoom),
          });
          const rightClick = async (element: Element) => {
            const box = element.getBoundingClientRect();
            const point = at(
              box.left + box.width / 2,
              box.top + box.height / 2,
            );
            const shown = new Promise<void>((resolve) =>
              win.addEventListener("contextmenu", () => resolve(), {
                once: true,
                capture: true,
              }),
            );
            contents.sendInputEvent({
              type: "mouseDown",
              ...point,
              button: "right",
              clickCount: 1,
            });
            contents.sendInputEvent({
              type: "mouseUp",
              ...point,
              button: "right",
              clickCount: 1,
            });
            await shown;
            return page.until("the context menu", () => {
              const items = [
                ...activeDocument.querySelectorAll<HTMLElement>(
                  ".menu .menu-item",
                ),
              ];
              return items.length > 0 ? items : null;
            });
          };
          const titleOf = (item: HTMLElement) =>
            item.querySelector(".menu-item-title")?.textContent ?? "";
          const copyFrom = async (items: HTMLElement[], title: string) => {
            page.press(
              items.find((item) => titleOf(item) === title),
              title,
            );
            return page.until(`the copied ${title}`, () =>
              win.navigator.clipboard.readText(),
            );
          };
          await win.navigator.clipboard.writeText("");

          reader.set({ sidebar: { open: true, panel: "thumbnails" } });
          const thumbnails = await page.until("three thumbnails", () => {
            const found = [
              ...reader.root.querySelectorAll<HTMLElement>(
                '[data-zpr-part="thumbnail"]',
              ),
            ];
            return found.length === 3 ? found : null;
          });
          await page.until("the thumbnails to paint", () =>
            thumbnails.every((thumbnail) =>
              thumbnail.querySelector("canvas[data-painted]"),
            ),
          );
          const labels = thumbnails.map(
            (thumbnail) => thumbnail.querySelector("span")?.textContent ?? "",
          );
          const pageMenu = await rightClick(thumbnails[1]!);
          const pageLink = {
            titles: pageMenu.map(titleOf),
            copied: await copyFrom(pageMenu, "Copy link to page 2"),
          };
          page.press(thumbnails[2], "the third thumbnail");
          await page.until("page 3", () => reader.state.get().pageIndex === 2);
          await reader.settled();
          const current = thumbnails[2]!.getAttribute("aria-current");

          reader.set({ sidebar: { panel: "outline" } });
          const rows = () =>
            [
              ...reader.root.querySelectorAll<HTMLElement>(
                '[data-zpr-part="outline-item"]',
              ),
            ].map((row) => ({
              title: row.querySelector(":scope > button")?.textContent ?? "",
              label:
                row.querySelector(":scope > span:last-child")?.textContent ??
                null,
              active: row.hasAttribute("data-active"),
            }));
          await page.until(
            "the outline labels",
            () => rows().filter((row) => row.label !== null).length === 2,
          );
          const before = rows();
          page.press(
            reader.root.querySelector<HTMLElement>(
              '[data-zpr-part="sidebar-menu"]',
            ),
            "the sidebar menu",
          );
          await page.menuReady();
          page.press(
            [
              ...activeDocument.querySelectorAll<HTMLElement>(
                ".menu .menu-item",
              ),
            ].find(
              (item) => titleOf(item) === "Reveal page in table of contents",
            ),
            "Reveal page in table of contents",
          );
          await page.until("the revealed section", () =>
            rows().some((row) => row.active),
          );
          const revealed = rows();
          const introduction = [
            ...reader.root.querySelectorAll<HTMLElement>(
              '[data-zpr-part="outline-item"]',
            ),
          ][0]!;
          const sectionMenu = await rightClick(introduction);
          const sectionLink = {
            titles: sectionMenu.map(titleOf),
            copied: await copyFrom(sectionMenu, "Copy link to “Introduction”"),
          };

          const handle = reader.root.querySelector<HTMLElement>(
            '[data-zpr-part="sidebar-resizer"]',
          )!;
          const content = reader.root.querySelector<HTMLElement>(
            '[data-zpr-part="content"]',
          )!;
          let width: number | undefined;
          const drag = async (toX: number) => {
            const box = handle.getBoundingClientRect();
            const y = box.top + box.height / 2;
            const fromX = box.left + box.width / 2;
            const up = new Promise<void>((resolve) =>
              win.addEventListener("pointerup", () => resolve(), {
                once: true,
                capture: true,
              }),
            );
            contents.sendInputEvent({
              type: "mouseDown",
              ...at(fromX, y),
              button: "left",
              clickCount: 1,
            });
            for (let step = 1; step <= 8; step++)
              contents.sendInputEvent({
                type: "mouseMove",
                ...at(fromX + ((toX - fromX) * step) / 8, y),
                button: "left",
                modifiers: ["leftButtonDown"],
              });
            contents.sendInputEvent({
              type: "mouseUp",
              ...at(toX, y),
              button: "left",
              clickCount: 1,
            });
            await up;
            return page.until("the stored width", () => {
              const stored = (
                app.loadLocalStorage(`${page.reader.viewType}:sidebar`) as {
                  width?: number;
                } | null
              )?.width;
              return stored !== undefined &&
                stored !== width &&
                stored === reader.state.get().sidebar.width
                ? stored
                : null;
            });
          };
          const left = content.getBoundingClientRect().left;
          width = reader.state.get().sidebar.width;
          const widest = await drag(left + content.clientWidth - 20);
          width = widest;
          const narrowest = await drag(left + 20);
          return {
            labels,
            pageLink,
            current,
            before,
            revealed,
            sectionLink,
            narrowest,
            widest: widest === Math.round(content.clientWidth / 2) || {
              widest,
              half: content.clientWidth / 2,
            },
          };
        },
        { path: "attachments/pdf-reader/chrome.pdf" },
        { timeoutMs: 60_000 },
      );
      expect(sidebar).toEqual({
        labels: ["i", "1", "2"],
        pageLink: {
          titles: ["Copy link to page 2"],
          copied: "[[chrome.pdf#page=2|chrome, page 2]]",
        },
        current: "page",
        before: [
          { title: "Introduction", label: "i", active: false },
          { title: "Methods", label: "1", active: false },
          { title: "Project site", label: null, active: false },
        ],
        revealed: [
          { title: "Introduction", label: "i", active: false },
          { title: "Methods", label: "1", active: false },
          { title: "Sampling", label: "2", active: true },
          { title: "Project site", label: null, active: false },
        ],
        sectionLink: {
          titles: ["Copy link to “Introduction”"],
          copied: "[[chrome.pdf#page=1&offset=72,720,0|chrome, Introduction]]",
        },
        narrowest: 140,
        widest: true,
      });
    });

    it("finds text from Mod+F with its options, keys and the 1000 cap, and keeps the options (E-6)", async () => {
      const found = await obRun(
        vaultId,
        async ({ app, page }, { chrome, navigation }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const open = async (path: string) => {
            const file = app.vault.getFileByPath(path)!;
            await page.reader.open(file, { pane: "tab" });
            const view = page.reader.views().find((v) => v.file === file)!;
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            app.workspace.setActiveLeaf(view.leaf, { focus: true });
            reader.focus();
            return { view, reader };
          };
          const mod = process.platform === "darwin" ? "meta" : "control";
          const { view, reader } = await open(chrome);
          const { win } = view.containerEl;
          const keys = page.trusted(win);
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const type = async (text: string) => {
            for (const char of text) {
              contents.sendInputEvent({ type: "keyDown", keyCode: char });
              contents.sendInputEvent({ type: "char", keyCode: char });
              contents.sendInputEvent({ type: "keyUp", keyCode: char });
            }
            await keys.key("Shift");
          };
          const phases = new Set<string>();
          cleanup.defer(
            reader.state.subscribe((state) => {
              phases.add(state.find.phase);
            }),
          );
          const part = <T extends HTMLElement = HTMLElement>(name: string) =>
            reader.root.querySelector<T>(`[data-zpr-part="${name}"]`)!;
          const result = () => {
            const { find } = reader.state.get();
            return {
              phase: find.phase,
              current: find.result?.current ?? null,
              total: find.result?.total ?? null,
              count: part("find-count").textContent,
            };
          };
          const settle = async (what: string, total: number | null) => {
            await page.until(
              what,
              () =>
                ["found", "not-found"].includes(
                  reader.state.get().find.phase,
                ) &&
                reader.state.get().find.result?.total === (total ?? undefined),
              5000,
            );
            return result();
          };
          const step = async (
            what: string,
            press: () => Promise<void>,
            current: number,
          ) => {
            await press();
            await page.until(
              what,
              () => reader.state.get().find.result?.current === current,
            );
            return reader.state.get().find.result!.current;
          };

          await keys.key("F", [mod]);
          const opened = await page.until(
            "the find bar",
            () =>
              reader.state.get().find.open &&
              part("find-input") === activeDocument.activeElement,
          );
          await type("fox");
          const fox = await settle("4 matches of fox", 4);
          const order = [
            await step("F3", () => keys.key("F3"), 2),
            await step("Shift+F3", () => keys.key("F3", ["shift"]), 1),
            await step("Mod+G", () => keys.key("G", [mod]), 2),
            await step("Mod+Shift+G", () => keys.key("G", [mod, "shift"]), 1),
            await step("Enter", () => keys.key("Return"), 2),
            await step("Shift+Enter", () => keys.key("Return", ["shift"]), 1),
          ];
          const highlighted = view.containerEl.querySelectorAll(
            ".textLayer .highlight",
          ).length;

          page.press(part("find-options"), "Search options");
          const option = (name: string) =>
            page.until(`the ${name} option`, () =>
              reader.root.querySelector<HTMLInputElement>(
                `[data-zpr-option="${name}"]`,
              ),
            );
          page.press(await option("entireWord"), "Whole words");
          const wholeWords = await settle("whole words", 3);
          page.press(part("find-match-case"), "Match case");
          const matchCase = await settle("match case", 2);
          page.press(part("find-match-case"), "Match case");
          page.press(await option("entireWord"), "Whole words");
          await settle("fox again", 4);

          const input = part<HTMLInputElement>("find-input");
          input.focus();
          input.select();
          await type("zebra");
          const zebra = await settle("no zebra", null);
          input.select();
          await type("cafe");
          const cafe = await settle("cafe", 2);
          page.press(await option("matchDiacritics"), "Match diacritics");
          const diacritics = await settle("cafe with diacritics", 1);

          const saved = app.loadLocalStorage(
            `${page.reader.viewType}:find-options`,
          );

          await keys.key("Escape");
          const closed = await page.until(
            "Escape to close the find bar",
            () => !reader.state.get().find.open,
          );

          await keys.key("F", [mod]);
          await page.until(
            "the find input for the composition",
            () => part("find-input") === activeDocument.activeElement,
          );
          const cdp = (
            win as Window & {
              electronWindow: { webContents: import("electron").WebContents };
            }
          ).electronWindow.webContents.debugger;
          if (!cdp.isAttached()) cdp.attach("1.3");
          cleanup.defer(() => {
            if (cdp.isAttached()) cdp.detach();
          });
          const escapes: { composing: boolean; prevented: boolean }[] = [];
          const watch = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
              escapes.push({
                composing: event.isComposing,
                prevented: event.defaultPrevented,
              });
            }
          };
          win.addEventListener("keydown", watch);
          cleanup.defer(() => win.removeEventListener("keydown", watch));
          await cdp.sendCommand("Input.imeSetComposition", {
            text: "ni",
            selectionStart: 2,
            selectionEnd: 2,
          });
          await cdp.sendCommand("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          });
          await cdp.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          });
          const before = reader.state.get().find.result?.current ?? null;
          for (const [key, modifiers] of [
            ["F3", {}],
            ["g", mod === "meta" ? { metaKey: true } : { ctrlKey: true }],
          ] as const) {
            input.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                isComposing: true,
                keyCode: 229,
                bubbles: true,
                cancelable: true,
                ...modifiers,
              }),
            );
          }
          const composing = {
            open: reader.state.get().find.open,
            escapes,
            kept: (reader.state.get().find.result?.current ?? null) === before,
          };
          await cdp.sendCommand("Input.insertText", { text: "" });
          cdp.detach();

          const second = await open(navigation);
          second.reader.set({ find: { open: true, query: "e" } });
          await page.until(
            "the capped count",
            () => second.reader.state.get().find.result?.capped,
            10000,
          );
          const capped = {
            ...second.reader.state.get().find.result!,
            count: second.reader.root.querySelector(
              '[data-zpr-part="find-count"]',
            )!.textContent,
            matchDiacritics: second.reader.state.get().find.matchDiacritics,
          };
          return {
            opened,
            fox,
            order,
            highlighted: highlighted >= 4,
            wholeWords,
            matchCase,
            zebra,
            cafe,
            diacritics,
            saved: JSON.stringify(saved),
            composing,
            closed,
            pending: phases.has("pending"),
            capped,
          };
        },
        {
          chrome: "attachments/pdf-reader/chrome.pdf",
          navigation: "attachments/pdf-reader/navigation.pdf",
        },
        { timeoutMs: 60_000 },
      );
      expect(found).toEqual({
        opened: true,
        fox: { phase: "found", current: 1, total: 4, count: "1 of 4 matches" },
        order: [2, 1, 2, 1, 2, 1],
        highlighted: true,
        wholeWords: {
          phase: "found",
          current: 1,
          total: 3,
          count: "1 of 3 matches",
        },
        matchCase: {
          phase: "found",
          current: 1,
          total: 2,
          count: "1 of 2 matches",
        },
        zebra: {
          phase: "not-found",
          current: null,
          total: null,
          count: "No matches",
        },
        cafe: { phase: "found", current: 1, total: 2, count: "1 of 2 matches" },
        diacritics: {
          phase: "found",
          current: 1,
          total: 1,
          count: "1 of 1 match",
        },
        saved: JSON.stringify({
          caseSensitive: false,
          highlightAll: true,
          matchDiacritics: true,
          entireWord: false,
        }),
        composing: {
          open: true,
          escapes: [{ composing: true, prevented: false }],
          kept: true,
        },
        closed: true,
        pending: true,
        capped: {
          current: 1,
          total: 1000,
          capped: true,
          count: "1 of more than 1000 matches",
          matchDiacritics: true,
        },
      });
    });

    it("zooms at the cursor with Ctrl or Command and the wheel and with a pinch, pages with the arrow keys only in a fit mode, and closes with Escape (E-7)", async () => {
      await raiseWindow(vaultId);
      const input = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          app.workspace.setActiveLeaf(view.leaf, { focus: true });
          reader.focus();
          const { win } = view.containerEl;
          const keys = page.trusted(win);
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const zoom = (
            require("electron") as { webFrame: { getZoomFactor(): number } }
          ).webFrame.getZoomFactor();
          const box = reader.container.getBoundingClientRect();
          const cursor = {
            x: box.left + box.width * 0.7,
            y: box.top + box.height * 0.4,
          };
          const under = () => {
            const target = reader
              .renderedPages()
              .map((rendered) => ({
                rendered,
                rect: rendered.div.getBoundingClientRect(),
              }))
              .find(
                ({ rect }) =>
                  rect.top <= cursor.y &&
                  rect.bottom >= cursor.y &&
                  rect.left <= cursor.x &&
                  rect.right >= cursor.x,
              );
            if (!target) return null;
            return {
              pageIndex: target.rendered.pageIndex,
              x: (cursor.x - target.rect.left) / target.rect.width,
              y: (cursor.y - target.rect.top) / target.rect.height,
              rect: target.rect,
            };
          };
          const wheel = async (deltaY: number, count: number) => {
            const scale = reader.state.get().scale;
            const done = new Promise<void>((resolve) => {
              let seen = 0;
              const counted = () => {
                if (++seen < count) return;
                win.removeEventListener("wheel", counted, true);
                resolve();
              };
              win.addEventListener("wheel", counted, true);
            });
            for (let index = 0; index < count; index++)
              contents.sendInputEvent({
                type: "mouseWheel",
                x: Math.round(cursor.x * zoom),
                y: Math.round(cursor.y * zoom),
                deltaX: 0,
                deltaY,
                canScroll: true,
                modifiers: ["control"],
              });
            await done;
            await page.until(
              "the scale to change",
              () => reader.state.get().scale !== scale,
            );
            await reader.settled();
            return scale;
          };
          reader.set({ zoom: 1.5 });
          await reader.settled();
          reader.container.scrollLeft =
            (reader.container.scrollWidth - reader.container.clientWidth) / 2;
          await reader.settled();
          const before = under()!;
          const fromScale = await wheel(120, 1);
          const after = under()!;
          const atCursor = {
            zoomedIn: reader.state.get().scale > fromScale,
            samePage: after.pageIndex === before.pageIndex,
            kept:
              Math.abs((after.x - before.x) * after.rect.width) <= 6 &&
              Math.abs((after.y - before.y) * after.rect.height) <= 6,
          };
          const pinchFrom = await wheel(3, 4);
          const pinched =
            reader.state.get().scale > pinchFrom &&
            reader.state.get().scale < pinchFrom * 1.5;

          reader.set({ zoom: "page-width" });
          await reader.navigate({ pageIndex: 1 });
          await reader.settled();
          reader.focus();
          const startPage = reader.state.get().pageIndex;
          await keys.key("Right");
          await page.until(
            "ArrowRight to turn the page",
            () => reader.state.get().pageIndex === startPage + 1,
          );
          await keys.key("Left");
          await page.until(
            "ArrowLeft to turn back",
            () => reader.state.get().pageIndex === startPage,
          );
          reader.set({ zoom: 1.5 });
          await reader.settled();
          reader.focus();
          await keys.key("Right");
          await reader.settled();
          const fixedZoom = reader.state.get().pageIndex;

          await reader.navigate("#page=4&annotation=5R");
          await reader.settled();
          reader.set({ find: { open: true } });
          await page.until("the find bar", () => reader.state.get().find.open);
          reader.focus();
          const marked = () =>
            reader.root.querySelector('[data-zpr-highlight="annotation"]') !==
            null;
          const highlighted = marked();
          await keys.key("Escape");
          await page.until(
            "Escape to close the find bar",
            () => !reader.state.get().find.open,
          );
          return {
            atCursor,
            pinched,
            arrows: { startPage, fixedZoom },
            escape: {
              highlighted,
              cleared: !marked(),
              fallsThrough: reader.command("escape") === false,
            },
          };
        },
        { path: "attachments/pdf-reader/navigation.pdf" },
        { timeoutMs: 60_000 },
      );
      expect(input).toEqual({
        atCursor: { zoomedIn: true, samePage: true, kept: true },
        pinched: true,
        arrows: { startPage: 1, fixedZoom: 1 },
        escape: { highlighted: true, cleared: true, fallsThrough: true },
      });
    });

    it("copies the selected text, as a quote and as a link from its context menu (E-9)", async () => {
      const text = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          const { win } = view.containerEl;
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const zoom = (
            require("electron") as { webFrame: { getZoomFactor(): number } }
          ).webFrame.getZoomFactor();
          const first = (await reader.whenRendered(0))!;
          const span = [
            ...first.div.querySelectorAll<HTMLElement>(".textLayer span"),
          ].find((node) => node.textContent === "The fox and the Fox.")!;
          const titleOf = (item: HTMLElement) =>
            item.querySelector(".menu-item-title")?.textContent ?? "";
          const select = () => {
            const node = span.firstChild!;
            const range = win.document.createRange();
            range.setStart(node, 4);
            range.setEnd(node, 15);
            const selection = win.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            return range.getBoundingClientRect();
          };
          const menuOf = async () => {
            const rect = select();
            const point = {
              x: Math.round((rect.left + rect.width / 2) * zoom),
              y: Math.round((rect.top + rect.height / 2) * zoom),
            };
            const shown = new Promise<void>((resolve) =>
              win.addEventListener("contextmenu", () => resolve(), {
                once: true,
                capture: true,
              }),
            );
            contents.sendInputEvent({
              type: "mouseDown",
              ...point,
              button: "right",
              clickCount: 1,
            });
            contents.sendInputEvent({
              type: "mouseUp",
              ...point,
              button: "right",
              clickCount: 1,
            });
            await shown;
            return page.until("the text menu", () => {
              const items = [
                ...activeDocument.querySelectorAll<HTMLElement>(
                  ".menu .menu-item",
                ),
              ];
              return items.length > 0 ? items : null;
            });
          };
          const copied: Record<string, string> = {};
          let titles: string[] = [];
          for (const title of [
            "Copy",
            "Copy as quote",
            "Copy link to selection",
          ]) {
            await win.navigator.clipboard.writeText("");
            const items = await menuOf();
            titles = items.map(titleOf);
            page.press(
              items.find((item) => titleOf(item) === title),
              title,
            );
            copied[title] = await page.until(`the copied ${title}`, () =>
              win.navigator.clipboard.readText(),
            );
          }
          await page.trusted(win).key("Escape");
          return { titles, copied, mac: process.platform === "darwin" };
        },
        { path: "attachments/pdf-reader/chrome.pdf" },
        { timeoutMs: 60_000 },
      );
      const link = text.copied["Copy link to selection"] ?? "";
      const at = /#page=1&selection=(\d+),4,\1,15\|/.exec(link)?.[1];
      expect(at).toBeDefined();
      const expected = `[[chrome.pdf#page=1&selection=${at},4,${at},15|chrome, page 1]]`;
      expect(text).toEqual({
        titles: [
          ...(text.mac ? ["Look up “fox and the”"] : []),
          "Copy",
          "Copy as quote",
          "Copy link to selection",
        ],
        copied: {
          Copy: "fox and the",
          "Copy as quote": `> fox and the\n\n${expected}`,
          "Copy link to selection": expected,
        },
        mac: text.mac,
      });
    });

    it("follows PDF links, renders a form and an auto-linked URL, and shows and copies a PDF annotation (E-10)", async () => {
      const annotations = await obRun(
        vaultId,
        async ({ app, page }, { chrome, forms }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const open = async (path: string) => {
            const file = app.vault.getFileByPath(path)!;
            await page.reader.open(file, { pane: "tab" });
            const view = page.reader.views().find((v) => v.file === file)!;
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            return { view, reader };
          };
          const { view, reader } = await open(chrome);
          const { win } = view.containerEl;
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const zoom = (
            require("electron") as { webFrame: { getZoomFactor(): number } }
          ).webFrame.getZoomFactor();
          const press = async (
            x: number,
            y: number,
            button: "left" | "right",
          ) => {
            const point = { x: Math.round(x * zoom), y: Math.round(y * zoom) };
            const up = new Promise<void>((resolve) =>
              win.addEventListener("mouseup", () => resolve(), {
                once: true,
                capture: true,
              }),
            );
            contents.sendInputEvent({
              type: "mouseDown",
              ...point,
              button,
              clickCount: 1,
            });
            contents.sendInputEvent({
              type: "mouseUp",
              ...point,
              button,
              clickCount: 1,
            });
            await up;
          };
          const centre = (element: Element) => {
            const box = element.getBoundingClientRect();
            return [
              box.left + box.width / 2,
              box.top + box.height / 2,
            ] as const;
          };
          const pdfPoint = async (pageIndex: number, x: number, y: number) => {
            await reader.navigate({ pageIndex });
            await reader.settled();
            const rendered = (await reader.whenRendered(pageIndex))!;
            const [left, top] = rendered.viewport.convertToViewportPoint(x, y);
            const box = rendered.div.getBoundingClientRect();
            return [
              box.left + rendered.div.clientLeft + left,
              box.top + rendered.div.clientTop + top,
            ] as const;
          };
          const titleOf = (item: HTMLElement) =>
            item.querySelector(".menu-item-title")?.textContent ?? "";

          const first = (await reader.whenRendered(0))!;
          const internal = await page.until("the link to page three", () =>
            first.div.querySelector<HTMLElement>(
              '.annotationLayer [data-annotation-id="11R"] a',
            ),
          );
          await press(...centre(internal), "left");
          await page.until(
            "the internal link to land on page three",
            () => reader.state.get().pageIndex === 2,
          );
          await reader.settled();
          const internalLink = reader.state.get().pageIndex;

          await reader.navigate({ pageIndex: 0 });
          await reader.settled();
          const external = first.div.querySelector<HTMLElement>(
            '.annotationLayer [data-annotation-id="10R"] a',
          )!;
          const followed: string[] = [];
          const opened = Reflect.get(win, "open");
          cleanup.defer(() => {
            win.open = opened;
          });
          win.open = (url) => {
            followed.push(String(url));
            return null;
          };
          const intercept = (event: MouseEvent) => {
            const anchor = (event.target as Element | null)?.closest("a");
            if (!anchor || !anchor.href.startsWith("https:")) return;
            event.preventDefault();
            followed.push(anchor.href);
          };
          win.addEventListener("click", intercept, true);
          cleanup.defer(() =>
            win.removeEventListener("click", intercept, true),
          );
          await press(...centre(external), "left");
          const externalLink = await page.until(
            "the external link",
            () => followed[0],
          );

          const [hx, hy] = await pdfPoint(1, 205, 604);
          await press(hx, hy, "left");
          const popup = await page.until("the annotation popup", () =>
            reader.root.querySelector<HTMLElement>(
              '[data-zpr-part="annotation-popup"]',
            ),
          );
          await win.navigator.clipboard.writeText("");
          page.press(
            popup.querySelector<HTMLElement>(
              '[data-zpr-part="annotation-copy"]',
            ),
            "the popup's copy button",
          );
          const shownPopup = {
            contents:
              popup.querySelector('[data-zpr-part="annotation-contents"]')
                ?.textContent ?? null,
            meta:
              popup.querySelector("span.zpr\\:truncate")?.textContent ?? null,
            expectedMeta: `Ada Lovelace · ${new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(1_704_164_645_000)}`,
            copied: await page.until("the popup copy", () =>
              win.navigator.clipboard.readText(),
            ),
          };
          await page.trusted(win).key("Escape");
          await page.until(
            "the popup to close",
            () =>
              !reader.root.querySelector('[data-zpr-part="annotation-popup"]'),
          );

          const menu: Record<string, string> = {};
          let titles: string[] = [];
          for (const title of ["Copy annotation", "Copy link to annotation"]) {
            await win.navigator.clipboard.writeText("");
            const [mx, my] = await pdfPoint(1, 205, 604);
            await press(mx, my, "right");
            const items = await page.until("the annotation menu", () => {
              const found = [
                ...activeDocument.querySelectorAll<HTMLElement>(
                  ".menu .menu-item",
                ),
              ];
              return found.length > 0 ? found : null;
            });
            titles = items.map(titleOf);
            page.press(
              items.find((item) => titleOf(item) === title),
              title,
            );
            menu[title] = await page.until(`the copied ${title}`, () =>
              win.navigator.clipboard.readText(),
            );
          }

          await reader.navigate("#page=2&annotation=9R");
          await reader.settled();
          const highlight = reader
            .pageAt(1)!
            .div.querySelector('[data-zpr-highlight="annotation"]');

          const form = await open(forms);
          const formPage = (await form.reader.whenRendered(0))!;
          const field = await page.until("the form field", () =>
            formPage.div.querySelector<HTMLInputElement>(
              ".annotationLayer .textWidgetAnnotation input",
            ),
          );
          const autoLink = await page.until("the auto-linked URL", () =>
            formPage.div.querySelector<HTMLAnchorElement>(
              '.annotationLayer a[href="https://example.org/auto"]',
            ),
          );
          return {
            internalLink,
            externalLink,
            popup: shownPopup,
            titles,
            menu,
            highlight: highlight !== null,
            form: field.value,
            autoLink: autoLink.href,
          };
        },
        {
          chrome: "attachments/pdf-reader/chrome.pdf",
          forms: "attachments/pdf-reader/forms.pdf",
        },
        { timeoutMs: 60_000 },
      );
      const highlight = "[[chrome.pdf#page=2&annotation=9R|chrome, page 2]]";
      expect(annotations).toEqual({
        internalLink: 2,
        externalLink: "https://example.org/paper",
        popup: {
          contents: "Check this sentence.",
          meta: annotations.popup.expectedMeta,
          expectedMeta: expect.stringMatching(/^Ada Lovelace · .*2024/),
          copied: `> The highlighted sentence on page two.\n\n[[chrome.pdf#page=2&annotation=9R]]\n\nCheck this sentence.`,
        },
        titles: ["Copy annotation", "Copy link to annotation"],
        menu: {
          "Copy annotation": `> The highlighted sentence on page two.\n\n${highlight}`,
          "Copy link to annotation": highlight,
        },
        highlight: true,
        form: "Ada Lovelace",
        autoLink: "https://example.org/auto",
      });
    });

    it("lands each subpath of a link in the reader that shows the file (E-11)", async () => {
      const landed = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          app.workspace.setActiveLeaf(view.leaf, { focus: true });
          const marks = (pageIndex: number, kind: string) =>
            reader
              .pageAt(pageIndex)!
              .div.querySelectorAll(`[data-zpr-highlight="${kind}"]`).length;
          const follow = async (subpath: string) => {
            const announced = new Promise<void>((resolve) => {
              const off = reader.on("subpath", () => {
                off();
                resolve();
              });
            });
            await app.workspace.openLinkText(`${file.name}${subpath}`, "");
            await announced;
            await reader.settled();
            const state = reader.state.get();
            return {
              sameView: view.leaf.view === view,
              pageIndex: state.pageIndex,
              zoom: state.zoom,
            };
          };
          const page3 = await follow("#page=3");
          const offset = await follow("#page=4&offset=0,300,0");
          const top =
            reader.pageAt(3)!.div.getBoundingClientRect().top -
            reader.container.getBoundingClientRect().top;
          const pageHeight = reader.pageAt(3)!.div.clientHeight;
          const selected = await follow("#page=2&selection=2,5,4,10");
          const mark = reader
            .pageAt(1)!
            .div.querySelector('[data-zpr-highlight="text"]');
          const shownBox = reader.container.getBoundingClientRect();
          const markBox = mark?.getBoundingClientRect();
          const selection = {
            sameView: selected.sameView,
            zoom: selected.zoom,
            marks: marks(1, "text") > 0,
            inView:
              markBox !== undefined &&
              markBox.top >= shownBox.top &&
              markBox.bottom <= shownBox.bottom,
          };
          const annotated = await follow(
            "#page=4&annotation=5R&selection=0,0,1,3",
          );
          const noteBox = reader
            .pageAt(3)!
            .div.querySelector('[data-zpr-highlight="annotation"]')
            ?.getBoundingClientRect();
          const viewBox = reader.container.getBoundingClientRect();
          const annotation = {
            sameView: annotated.sameView,
            zoom: annotated.zoom,
            marks: marks(3, "annotation"),
            text: marks(3, "text"),
            inView:
              noteBox !== undefined &&
              noteBox.top >= viewBox.top &&
              noteBox.bottom <= viewBox.bottom,
          };
          const named = await follow("#chapter-six");
          const sixth = reader.pageAt(5)!.div;
          const atDest =
            Math.abs(
              sixth.getBoundingClientRect().top -
                reader.container.getBoundingClientRect().top +
                ((792 - 400) / 792) * sixth.clientHeight,
            ) <= 4;
          const zoomed = {
            ...(await follow("#zoom=200")),
            scale: reader.state.get().scale,
          };
          const searched = {
            ...(await follow("#search=line")),
            open: reader.state.get().find.open,
            query: reader.state.get().find.query,
          };
          return {
            page3,
            offset: {
              ...offset,
              atTop: Math.abs(top + ((792 - 300) / 792) * pageHeight) <= 4,
            },
            selection,
            annotation,
            named: { sameView: named.sameView, atDest },
            zoomed: {
              sameView: zoomed.sameView,
              zoom: zoomed.zoom,
              scale: zoomed.scale,
            },
            searched: {
              sameView: searched.sameView,
              open: searched.open,
              query: searched.query,
            },
          };
        },
        { path: "attachments/pdf-reader/navigation.pdf" },
        { timeoutMs: 60_000 },
      );
      expect(landed).toEqual({
        page3: { sameView: true, pageIndex: 2, zoom: "page-width" },
        offset: {
          sameView: true,
          pageIndex: 4,
          zoom: "page-width",
          atTop: true,
        },
        selection: {
          sameView: true,
          zoom: "page-width",
          marks: true,
          inView: true,
        },
        annotation: {
          sameView: true,
          zoom: "page-width",
          marks: 1,
          text: 0,
          inView: true,
        },
        named: { sameView: true, atDest: true },
        zoomed: { sameView: true, zoom: 2, scale: 2 },
        searched: { sameView: true, open: true, query: "line" },
      });
    });

    it("restores the page, the scroll, the sidebar and the spread of a file, and goes back and forward (E-12)", async () => {
      const state = await obRun(
        vaultId,
        async ({ app, page }, { navigation, chrome }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const open = async (path: string, subpath = "") => {
            const file = app.vault.getFileByPath(path)!;
            const known = new Set(page.reader.views());
            await page.reader.open(file, { subpath, pane: "tab" });
            const view = page.reader
              .views()
              .find((v) => v.file === file && !known.has(v))!;
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            return { view, reader };
          };
          const storedTop = () =>
            (
              app.loadLocalStorage(`${page.reader.viewType}:positions`) as
                | { readonly top: number }[]
                | null
            )?.[0]?.top ?? null;
          const topOf = (reader: NonNullable<typeof first.reader>) => {
            const div = reader.pageAt(4)!.div;
            return (
              (reader.container.getBoundingClientRect().top -
                div.getBoundingClientRect().top) /
              div.clientHeight
            );
          };

          const first = await open(navigation);
          await first.reader.navigate({ pageIndex: 4 });
          await first.reader.settled();
          const scrolled = new Promise<void>((resolve) =>
            first.reader.container.addEventListener("scroll", () => resolve(), {
              once: true,
            }),
          );
          first.reader.container.scrollTop += 40;
          await scrolled;
          await page.until("the stored scroll", () => storedTop() !== 792);
          first.reader.set({ sidebar: { open: true, panel: "thumbnails" } });
          await first.reader.settled();
          const before = {
            pageIndex: first.reader.state.get().pageIndex,
            top: topOf(first.reader),
          };
          const again = await open(navigation);
          const reopened = {
            pageIndex: again.reader.state.get().pageIndex === before.pageIndex,
            scroll: Math.abs(topOf(again.reader) - before.top) < 0.01,
            sidebar: again.reader.state.get().sidebar.open,
            panel: again.reader.state.get().sidebar.panel,
            zoom: again.reader.state.get().zoom,
          };

          const history = await open(navigation, "#page=6");
          const { leaf } = history.view;
          const opened = history.reader.state.get().pageIndex;
          app.workspace.setActiveLeaf(leaf, { focus: true });
          await app.workspace.openLinkText("chrome.pdf", "");
          const readerIn = (path: string) => {
            const reader = page.reader.readerOf(leaf.view);
            return reader &&
              (leaf.view as { file?: { path: string } | null }).file?.path ===
                path &&
              reader.state.get().status === "ready"
              ? reader
              : null;
          };
          await page.until("the link to chrome.pdf", () => readerIn(chrome));
          app.commands.executeCommandById("app:go-back");
          const back = await page.until("back to navigation.pdf", () =>
            readerIn(navigation),
          );
          await back.settled();
          const backPage = back.state.get().pageIndex;
          app.commands.executeCommandById("app:go-forward");
          await page.until("forward to chrome.pdf", () => readerIn(chrome));

          const spreadFile = await open(chrome);
          spreadFile.reader.set({ spread: "odd" });
          await spreadFile.reader.settled();
          const sameFile = await open(chrome);
          const otherFile = await open(navigation);
          return {
            reopened,
            history: { opened, backPage },
            spread: {
              sameFile: sameFile.reader.state.get().spread,
              otherFile: otherFile.reader.state.get().spread,
            },
          };
        },
        {
          navigation: "attachments/pdf-reader/navigation.pdf",
          chrome: "attachments/pdf-reader/chrome.pdf",
        },
        { timeoutMs: 60_000 },
      );
      expect(state).toEqual({
        reopened: {
          pageIndex: true,
          scroll: true,
          sidebar: true,
          panel: "thumbnails",
          zoom: "page-width",
        },
        history: { opened: 5, backPage: 5 },
        spread: { sameFile: "odd", otherFile: "none" },
      });
    });

    it("renders embeds, hover previews and canvas cards in the reader while the takeover is on, and a text drag selects text there (E-15, E-16)", async () => {
      await raiseWindow(vaultId);
      const embedded = await obRun(
        vaultId,
        async ({ app, page }, { note, canvasFile }) => {
          await using cleanup = new AsyncDisposableStack();
          await page.reader.withTakeover(cleanup, true);
          const leaves = new Set<{ detach(): void }>();
          cleanup.defer(() => {
            for (const leaf of leaves) leaf.detach();
          });
          const { win } = app.workspace.containerEl;
          const contents = (
            win as Window & {
              electronWindow: {
                webContents: { sendInputEvent(event: object): void };
              };
            }
          ).electronWindow.webContents;
          const zoom = (
            require("electron") as { webFrame: { getZoomFactor(): number } }
          ).webFrame.getZoomFactor();
          const dragAcross = async (span: HTMLElement) => {
            const box = span.getBoundingClientRect();
            const y = box.top + box.height / 2;
            const from = box.left + 2;
            const to = box.right - 2;
            const at = (x: number) => ({
              x: Math.round(x * zoom),
              y: Math.round(y * zoom),
            });
            const up = new Promise<void>((resolve) =>
              win.addEventListener("mouseup", () => resolve(), {
                once: true,
                capture: true,
              }),
            );
            win.getSelection()?.removeAllRanges();
            contents.sendInputEvent({
              type: "mouseDown",
              ...at(from),
              button: "left",
              clickCount: 1,
            });
            for (let step = 1; step <= 10; step++)
              contents.sendInputEvent({
                type: "mouseMove",
                ...at(from + ((to - from) * step) / 10),
                button: "left",
                modifiers: ["leftButtonDown"],
              });
            contents.sendInputEvent({
              type: "mouseUp",
              ...at(to),
              button: "left",
              clickCount: 1,
            });
            await up;
            return win.getSelection()?.toString().trim() ?? "";
          };
          const textOf = (root: HTMLElement) =>
            page.until(
              "the reader's text",
              () =>
                [...root.querySelectorAll<HTMLElement>(".textLayer span")].find(
                  (span) => {
                    if ((span.textContent?.trim().length ?? 0) <= 8)
                      return false;
                    const box = span.getBoundingClientRect();
                    return (
                      box.width > 20 &&
                      span.ownerDocument.elementFromPoint(
                        box.left + box.width / 2,
                        box.top + box.height / 2,
                      ) === span
                    );
                  },
                ) ?? null,
              10000,
            );

          const noteLeaf = app.workspace.getLeaf("tab");
          leaves.add(noteLeaf);
          await noteLeaf.setViewState({
            type: "markdown",
            state: { file: note, mode: "source", source: false },
            active: true,
          });
          const root = noteLeaf.view.containerEl;
          const editor = (
            noteLeaf.view as unknown as {
              editor: {
                setCursor(line: number, ch: number): void;
                getCursor(): { line: number; ch: number };
              };
            }
          ).editor;
          const scroller = root.querySelector<HTMLElement>(".cm-scroller")!;
          editor.setCursor(0, 0);
          const cursor = await page.until("the cursor to settle", () => {
            const { line, ch } = editor.getCursor();
            return JSON.stringify({ line, ch });
          });
          const live = await page.until(
            "the Live Preview embed",
            () => {
              const found = root.querySelector<HTMLElement>(
                '.markdown-source-view .pdf-embed[src="excerpt-rendering.pdf"] .zpr-root[data-zpr-kind="embed"]',
              );
              if (!found) scroller.scrollTop += scroller.clientHeight / 2;
              return found;
            },
            10000,
          );
          live.scrollIntoView({ block: "center", behavior: "instant" });
          const liveSpan = await textOf(live);
          const livePreview = {
            selected: await dragAcross(liveSpan),
            cursorKept:
              JSON.stringify({
                line: editor.getCursor().line,
                ch: editor.getCursor().ch,
              }) === cursor,
            stillEmbedded: live.isConnected,
          };
          const heightOf = (embed: HTMLElement) => {
            const toolbar = embed.querySelector<HTMLElement>(
              '[data-zpr-part="toolbar"]',
            )!.offsetHeight;
            const content = embed.querySelector<HTMLElement>(
              '[data-zpr-part="content"]',
            )!.offsetHeight;
            return {
              toolbar,
              content,
              holds: Math.abs(embed.clientHeight - (toolbar + content)) <= 1,
            };
          };
          const liveFixed = await page.until(
            "the Live Preview embed of #height=300",
            () => {
              const found = root.querySelector<HTMLElement>(
                '.markdown-source-view .pdf-embed.zpr-fit-height[src="excerpt-rendering.pdf#height=300"]',
              );
              if (!found) scroller.scrollTop += scroller.clientHeight / 2;
              const height = found && heightOf(found);
              return height && height.toolbar > 0 ? height : null;
            },
            10000,
          );

          await noteLeaf.setViewState({
            type: "markdown",
            state: { file: note, mode: "preview" },
            active: true,
          });
          const preview = root.querySelector<HTMLElement>(
            ".markdown-preview-view",
          )!;
          const embedOf = (src: string) =>
            page.until(
              `the embed ${src}`,
              () => {
                const found = preview.querySelector<HTMLElement>(
                  `.internal-embed.pdf-embed[src="${src}"]:has(.zpr-root[data-zpr-kind="embed"] .page canvas)`,
                );
                if (!found) preview.scrollTop += preview.clientHeight / 2;
                if (found)
                  found.scrollIntoView({ block: "start", behavior: "instant" });
                const height = found && heightOf(found);
                return height && height.toolbar > 0 ? { found, height } : null;
              },
              10000,
            );
          const onePage = await embedOf("excerpt-rendering.pdf");
          const pageHeight = onePage.found.querySelector<HTMLElement>(
            '.page[data-page-number="1"]',
          )!.offsetHeight;
          const fixed = await embedOf("excerpt-rendering.pdf#height=300");
          const heights = {
            pageTall:
              Math.abs(onePage.height.content - pageHeight) <= 1 &&
              onePage.height.holds,
            fixed:
              Math.abs(fixed.height.content - 300) <= 1 && fixed.height.holds,
            liveFixed:
              Math.abs(liveFixed.content - 300) <= 1 && liveFixed.holds,
          };
          const second = await embedOf("excerpt-rendering.pdf#page=2");
          const secondAtPage2 = await page
            .until(
              "the #page=2 embed at page 2",
              () => {
                const pageTop = second.found
                  .querySelector<HTMLElement>('.page[data-page-number="2"]')
                  ?.getBoundingClientRect().top;
                const scrollerTop = second.found
                  .querySelector<HTMLElement>('[data-zpr-part="scroller"]')
                  ?.getBoundingClientRect().top;
                return pageTop !== undefined &&
                  scrollerTop !== undefined &&
                  Math.abs(pageTop - scrollerTop) <= 16
                  ? true
                  : null;
              },
              5000,
            )
            .catch(() => false);
          onePage.found.scrollIntoView({ block: "start", behavior: "instant" });
          page.press(
            onePage.found.querySelector<HTMLElement>(
              '[data-zpr-slot="toolbar-end"] [aria-label="More options"]',
            ),
            "the embed's More options",
          );
          await page.menuReady();
          const menu = [
            ...root.doc.querySelectorAll(".menu .menu-item-title"),
          ].map((title) => title.textContent);
          await page.trusted(win).key("Escape");
          const embeds = {
            secondAtPage2,
            menuStartsWithOpen: menu[0] === "Open",
            linkMenu: menu.includes("Open in new tab"),
          };
          const link = await page.until(
            "the link to page 3",
            () => {
              const found = preview.querySelector<HTMLElement>(
                '.internal-link[data-href="excerpt-rendering.pdf#page=3"]',
              );
              if (!found) preview.scrollTop += preview.clientHeight / 2;
              return found;
            },
            10000,
          );
          link.scrollIntoView({ block: "center", behavior: "instant" });
          const linkBox = link.getBoundingClientRect();
          cleanup.defer(() => {
            (
              noteLeaf.view as { hoverPopover?: { hide(): void } | null }
            ).hoverPopover?.hide();
          });
          app.workspace.trigger("hover-link", {
            event: new MouseEvent("mouseover", {
              clientX: linkBox.left + 2,
              clientY: linkBox.top + 2,
              ctrlKey: true,
              metaKey: true,
            }),
            source: "preview",
            hoverParent: noteLeaf.view,
            targetEl: link,
            linktext: "excerpt-rendering.pdf#page=3",
            sourcePath: note,
          });
          const popover = await page.until(
            "the hover preview's reader",
            () =>
              root.doc.querySelector<HTMLElement>(
                '.hover-popover .zpr-root[data-zpr-kind="hover"]',
              ),
            10000,
          );
          await textOf(popover);
          const hover = {
            toolbar: popover.querySelector<HTMLElement>(
              '[data-zpr-part="toolbar"]',
            )!.offsetHeight,
            page3:
              popover.querySelector('.page[data-page-number="3"]') !== null,
          };

          const canvasLeaf = app.workspace.getLeaf("tab");
          leaves.add(canvasLeaf);
          await canvasLeaf.openFile(app.vault.getFileByPath(canvasFile)!);
          const card = await page.until(
            "the canvas card's reader",
            () =>
              canvasLeaf.view.containerEl.querySelector<HTMLElement>(
                '.canvas-node .zpr-root[data-zpr-kind="canvas"]',
              ),
            10000,
          );
          const node = card.closest<HTMLElement>(".canvas-node")!;
          const placed = node.getBoundingClientRect();
          await page.trusted(win).click(card);
          const focused = await page.until("the focused card", () =>
            node.classList.contains("is-focused"),
          );
          const cardSpan = await textOf(card);
          const selected = await dragAcross(cardSpan);
          const moved = node.getBoundingClientRect();
          const canvas = {
            focused,
            selected: selected.length > 0,
            kept:
              Math.abs(moved.left - placed.left) < 1 &&
              Math.abs(moved.top - placed.top) < 1,
          };

          await page.reader.setTakeover(false);
          const after = app.workspace.getLeaf("tab");
          leaves.add(after);
          await after.setViewState({
            type: "markdown",
            state: { file: note, mode: "preview" },
            active: true,
          });
          const obsidianEmbed = await page.until(
            "Obsidian's own embed",
            () => {
              const view = after.view.containerEl.querySelector<HTMLElement>(
                ".markdown-preview-view",
              )!;
              const found = view.querySelector<HTMLElement>(
                '.internal-embed.pdf-embed[src="excerpt-rendering.pdf"]',
              );
              if (!found) view.scrollTop += view.clientHeight / 2;
              return found?.querySelector(".pdf-container, .pdf-toolbar")
                ? found
                : null;
            },
            10000,
          );
          return {
            livePreview: {
              selected: livePreview.selected.length > 0,
              cursorKept: livePreview.cursorKept,
              stillEmbedded: livePreview.stillEmbedded,
            },
            heights,
            embeds,
            hover,
            canvas,
            restored: obsidianEmbed.querySelector(".zpr-root") === null,
          };
        },
        {
          note: "pdf-reader-embeds.md",
          canvasFile: "pdf-reader-embeds.canvas",
        },
        { timeoutMs: 60_000 },
      );
      expect(embedded).toEqual({
        livePreview: {
          selected: true,
          cursorKept: true,
          stillEmbedded: true,
        },
        heights: { pageTall: true, fixed: true, liveFixed: true },
        embeds: {
          secondAtPage2: true,
          menuStartsWithOpen: true,
          linkMenu: true,
        },
        hover: { toolbar: 0, page3: true },
        canvas: { focused: true, selected: true, kept: true },
        restored: true,
      });
    });

    it("applies Obsidian's --pdf-* variables and keeps Adapt to theme for the next reader (E-13)", async () => {
      const themed = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const body = app.workspace.containerEl.doc.body;
          body.style.setProperty("--pdf-background", "rgb(10, 20, 30)");
          body.style.setProperty("--pdf-page-background", "rgb(200, 210, 220)");
          cleanup.defer(() => {
            body.style.removeProperty("--pdf-background");
            body.style.removeProperty("--pdf-page-background");
          });
          const open = async () => {
            const file = app.vault.getFileByPath(path)!;
            const known = new Set(page.reader.views());
            await page.reader.open(file, { pane: "tab" });
            const view = page.reader
              .views()
              .find((v) => v.file === file && !known.has(v))!;
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            return reader;
          };
          const reader = await open();
          const css = (element: Element) =>
            element.ownerDocument.defaultView!.getComputedStyle(element)
              .backgroundColor;
          const variables = {
            scroller: css(reader.container),
            page: css(reader.pageAt(0)!.div.querySelector(".canvasWrapper")!),
          };
          reader.set({ themed: true });
          await reader.settled();
          const second = await open();
          return {
            variables,
            themed: reader.root.classList.contains("mod-themed"),
            kept: second.root.classList.contains("mod-themed"),
          };
        },
        { path: "attachments/pdf-reader/chrome.pdf" },
        { timeoutMs: 30_000 },
      );
      expect(themed).toEqual({
        variables: { scroller: "rgb(10, 20, 30)", page: "rgb(200, 210, 220)" },
        themed: true,
        kept: true,
      });
    });

    it("asks for the password of a locked PDF and opens it with that password (E-14)", async () => {
      const unlocked = await obRun(
        vaultId,
        async ({ app, page }, { path }) => {
          await using cleanup = new AsyncDisposableStack();
          const file = app.vault.getFileByPath(path)!;
          const view = await page.reader.openNew(cleanup, file, {
            pane: "tab",
          });
          const reader = await page.until("the reader", () => view.reader);
          const prompt = await page.until(
            "the password prompt",
            () =>
              reader.state.get().status === "password" &&
              reader.root.querySelector("[data-zpr-part='password']"),
            10000,
          );
          reader.root.querySelector<HTMLInputElement>(
            "[data-zpr-part='password-input']",
          )!.value = "zotlit";
          reader.root
            .querySelector<HTMLButtonElement>(
              "[data-zpr-part='password-open']",
            )!
            .click();
          const opened = (await reader.whenReady()) !== null;
          const promptGone = await page.until(
            "the password prompt to close",
            () => !reader.root.querySelector("[data-zpr-part='password']"),
          );
          return {
            prompted: prompt !== null,
            opened,
            status: reader.state.get().status,
            pageCount: reader.state.get().pageCount > 0,
            promptGone,
          };
        },
        { path: "attachments/pdf-reader/password.pdf" },
        { timeoutMs: 30_000 },
      );
      expect(unlocked).toEqual({
        prompted: true,
        opened: true,
        status: "ready",
        pageCount: true,
        promptGone: true,
      });
    });

    it("renders the 14 standard fonts from Obsidian's font files, and JBIG2 and JPX images (E-17, E-22)", async () => {
      const forkFonts = join(
        workspaceRoot,
        "packages/pdfjs/dist/standard_fonts",
      );
      const digests = Object.fromEntries(
        await Promise.all(
          ["FoxitSymbol.pfb", "FoxitDingbats.pfb"].map(
            async (name) =>
              [
                name,
                createHash("sha256")
                  .update(await readFile(join(forkFonts, name)))
                  .digest("hex"),
              ] as const,
          ),
        ),
      );
      const rendered = await obRun(
        vaultId,
        async ({ app, page }, { fonts, jbig2, jpx }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const leaf of app.workspace.getLeavesOfType(
              page.reader.viewType,
            ))
              leaf.detach();
          });
          const requests: Record<string, string> = {};
          const original = window.fetch;
          cleanup.defer(() => {
            window.fetch = original;
          });
          window.fetch = async (input, init) => {
            const response = await original(input, init);
            const url = input instanceof Request ? input.url : input.toString();
            if (url.includes("/lib/pdfjs/standard_fonts/") && response.ok) {
              const digest = await crypto.subtle.digest(
                "SHA-256",
                await response.clone().arrayBuffer(),
              );
              requests[url.slice(url.lastIndexOf("/") + 1)] = [
                ...new Uint8Array(digest),
              ]
                .map((byte) => byte.toString(16).padStart(2, "0"))
                .join("");
            }
            return response;
          };
          const open = async (path: string) => {
            const file = app.vault.getFileByPath(path)!;
            await page.reader.open(file, { pane: "tab" });
            const view = page.reader.views().find((v) => v.file === file)!;
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            return (await reader.whenRendered(0))!;
          };
          const pixels = (canvas: HTMLCanvasElement) => {
            const data = canvas
              .getContext("2d", { willReadFrequently: true })!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            let dark = 0;
            let grey = 0;
            for (let index = 0; index < data.length; index += 4) {
              const value = data[index]!;
              if (data[index + 3] === 0) continue;
              if (value < 64) dark++;
              else if (value > 112 && value < 144) grey++;
            }
            return { dark, grey };
          };
          const fontPage = await open(fonts);
          const lines =
            [...fontPage.div.querySelectorAll(".textLayer span")].filter(
              (span) => (span.textContent?.trim().length ?? 0) > 0,
            ).length >= 14;
          const jbig2Page = await open(jbig2);
          const jpxPage = await open(jpx);
          const canvasOf = (rendered: typeof jbig2Page) =>
            rendered.div.querySelector<HTMLCanvasElement>(
              ".canvasWrapper canvas",
            )!;
          return {
            lines,
            requests,
            jbig2: pixels(canvasOf(jbig2Page)).dark > 100,
            jpx: pixels(canvasOf(jpxPage)).grey > 100,
          };
        },
        {
          fonts: "attachments/pdf-reader/standard-fonts.pdf",
          jbig2: "attachments/pdf-reader/jbig2.pdf",
          jpx: "attachments/pdf-reader/jpx.pdf",
        },
        { timeoutMs: 30_000 },
      );
      expect(rendered).toEqual({
        lines: true,
        requests: digests,
        jbig2: true,
        jpx: true,
      });
    });

    it("renders a PDF in Obsidian's own view and in the Reader side by side with their own fonts (E-21)", async () => {
      const sideBySide = await obRun(
        vaultId,
        async ({ app, page }, { id, path }) => {
          await using cleanup = new AsyncDisposableStack();
          const stored = ["positions", "sidebar", "find-options", "themed"].map(
            (key) =>
              [
                key,
                app.loadLocalStorage(`${page.reader.viewType}:${key}`),
              ] as const,
          );
          cleanup.defer(() => {
            for (const [key, value] of stored)
              app.saveLocalStorage(
                `${page.reader.viewType}:${key}`,
                value ?? null,
              );
          });
          cleanup.defer(() => {
            for (const type of [page.reader.viewType, "pdf"])
              for (const leaf of app.workspace.getLeavesOfType(type))
                leaf.detach();
          });
          const file = app.vault.getFileByPath(path)!;
          const obsidianLeaf = app.workspace.getLeaf("split");
          await obsidianLeaf.setViewState({
            type: "pdf",
            state: { file: path },
            active: true,
          });
          const obsidianPage = await page.until(
            "Obsidian's PDF view to paint",
            () =>
              obsidianLeaf.view.containerEl.querySelector<HTMLCanvasElement>(
                '.page[data-page-number="1"] .canvasWrapper canvas',
              ),
            10000,
          );
          await page.reader.open(file, { pane: "tab" });
          const view = page.reader.views().find((v) => v.file === file)!;
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
          const ours = (await reader.whenRendered(0))!;
          const families = [
            ...new Set(
              [...app.workspace.containerEl.doc.fonts].map(
                (face) => face.family,
              ),
            ),
          ];
          const painted = (canvas: HTMLCanvasElement | null) => {
            if (!canvas) return false;
            const data = canvas
              .getContext("2d", { willReadFrequently: true })!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            for (let index = 0; index < data.length; index += 4)
              if (data[index + 3] !== 0 && data[index]! < 128) return true;
            return false;
          };
          return {
            obsidianView: obsidianLeaf.view.getViewType(),
            obsidianFonts: families.some((family) =>
              /^g_d\d+_s?f\d+$/.test(family),
            ),
            readerFonts: families.some(
              (family) =>
                family.startsWith(`g_${id}`) &&
                /^\d+_s?f\d+$/.test(family.slice(`g_${id}`.length)),
            ),
            obsidianPainted: painted(obsidianPage),
            readerPainted: painted(
              ours.div.querySelector<HTMLCanvasElement>(
                ".canvasWrapper canvas",
              ),
            ),
          };
        },
        { id: READER_ID, path: PDF_PATH },
        { timeoutMs: 30_000 },
      );
      expect(sideBySide).toEqual({
        obsidianView: "pdf",
        obsidianFonts: true,
        readerFonts: true,
        obsidianPainted: true,
        readerPainted: true,
      });
    });
  });

  describe("the contract probe, a plugin with no Zotero code that reaches the Reader through its API", () => {
    const enableProbe = async (data: ProbeData) => {
      await installReaderProbe(vaultPath);
      await writeProbeData(vaultPath, data);
      await obRun(
        vaultId,
        async ({ app }, { id }) => {
          await app.plugins.loadManifests();
          await app.plugins.enablePlugin(id);
        },
        { id: PROBE_ID },
      );
      return obRunUntil(
        vaultId,
        ({ app }, { id }) => {
          const probe = app.plugins.plugins[id] as
            | ReaderProbePlugin
            | undefined;
          const connection = probe?.connection ?? null;
          if (!connection) return null;
          return {
            state: connection.state,
            reason:
              connection.state === "refused"
                ? {
                    supported: [...connection.reason.supported],
                    readerVersion: connection.reason.readerVersion,
                  }
                : null,
          };
        },
        { id: PROBE_ID },
        {
          ready: (value) => value !== null,
          what: "the reader probe plugin to connect",
        },
      );
    };

    afterEach(async () => {
      await obRun(
        vaultId,
        async ({ app }, { id }) => {
          if (app.plugins.plugins[id]) await app.plugins.disablePlugin(id);
        },
        { id: PROBE_ID },
      );
      await removeReaderProbe(vaultPath);
    });

    it("the contract probe draws its layer in the Reader's view through a zoom", async () => {
      expect(await enableProbe({})).toEqual({
        state: "connected",
        reason: null,
      });
      const opened = await obRun(
        vaultId,
        async ({ app, page, reader: handles }, { id, path, layerId }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const file = app.vault.getFileByPath(path)!;
          const view = await page.reader.openNew(cleanup, file, {
            subpath: "#page=2",
            pane: "tab",
          });
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.whenRendered(1);
          await reader.settled();
          const layerOf = () =>
            reader
              .pageAt(1)
              ?.div.querySelector<HTMLElement>(
                `[data-zpr-layer="${layerId}"]`,
              ) ?? null;
          const layer = await page.until("the probe layer", layerOf);
          const drawn = probe.drawn;
          const repainted = new Promise<void>((resolve) => {
            const off = reader.on("page-rendered", ({ page: painted }) => {
              if (painted.pageIndex !== 1) return;
              off();
              resolve();
            });
          });
          reader.set({ zoom: 2 });
          await repainted;
          await reader.settled();
          const zoomed = layerOf();
          return {
            viewType: view.getViewType(),
            sameApi:
              probe.connection?.state === "connected" &&
              probe.connection.api === handles.api,
            attached: probe.attached.at(-1) ?? null,
            band: layer.querySelector(".probe-band") !== null,
            scale: reader.state.get().scale,
            sameLayer: zoomed === layer,
            bandAfterZoom: zoomed?.querySelector(".probe-band") !== null,
            redrawn: probe.drawn > drawn,
          };
        },
        { id: PROBE_ID, path: PDF_PATH, layerId: PROBE_LAYER },
        { timeoutMs: 30_000 },
      );
      expect(opened).toEqual({
        viewType: "zotlit-pdf",
        sameApi: true,
        attached: { kind: "view", subpath: "#page=2", restored: false },
        band: true,
        scale: 2,
        sameLayer: true,
        bandAfterZoom: true,
        redrawn: true,
      });
    });

    it("the probe enabled after a Reader tab is open gets its layer in that tab", async () => {
      await installReaderProbe(vaultPath);
      await writeProbeData(vaultPath, {});
      const attached = await obRun(
        vaultId,
        async ({ app, page }, { id, path, layerId }) => {
          await using cleanup = new AsyncDisposableStack();
          const file = app.vault.getFileByPath(path)!;
          const view = await page.reader.openNew(cleanup, file, {
            subpath: "#page=2",
            pane: "tab",
          });
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.whenRendered(1);
          await reader.settled();
          await app.plugins.loadManifests();
          await app.plugins.enablePlugin(id);
          const probe = await page.until(
            "the reader probe plugin to connect",
            () =>
              (app.plugins.plugins[id] as ReaderProbePlugin | undefined)
                ?.connection?.state === "connected"
                ? (app.plugins.plugins[id] as ReaderProbePlugin)
                : null,
          );
          const band = await page.until(
            "the probe layer in the open tab",
            () =>
              reader
                .pageAt(1)
                ?.div.querySelector(
                  `[data-zpr-layer="${layerId}"] .probe-band`,
                ) ?? null,
          );
          return {
            band: band !== null,
            attached: probe.attached.find((entry) => entry.kind === "view"),
          };
        },
        { id: PROBE_ID, path: PDF_PATH, layerId: PROBE_LAYER },
        { timeoutMs: 30_000 },
      );
      expect(attached).toEqual({
        band: true,
        attached: { kind: "view", subpath: null, restored: true },
      });
    });

    it("refuses a probe that claims version 2, keeps the Reader's tab working, and the probe reports the refusal (I-7)", async () => {
      const readerVersion = JSON.parse(
        await readFile(
          join(vaultPath, ".obsidian", "plugins", READER_ID, "manifest.json"),
          "utf8",
        ),
      ).version as string;
      expect(await enableProbe({ major: 2 })).toEqual({
        state: "refused",
        reason: { supported: [1], readerVersion },
      });
      const shown = await obRun(
        vaultId,
        async ({ app, page }, { id, path, layerId }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const file = app.vault.getFileByPath(path)!;
          const view = await page.reader.openNew(cleanup, file, {
            subpath: "#page=2",
            pane: "tab",
          });
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.whenRendered(1);
          await reader.settled();
          return {
            viewType: view.getViewType(),
            ours: page.reader.readerOf(view) === reader,
            status: reader.state.get().status,
            pageIndex: reader.state.get().pageIndex,
            text: (reader.pageAt(1)?.textLayer?.textContent.length ?? 0) > 0,
            probeLayer:
              reader.root.querySelector(`[data-zpr-layer="${layerId}"]`) !==
              null,
            attached: probe.attached.length,
            notices: [...activeDocument.querySelectorAll(".notice")]
              .map((notice) => notice.textContent)
              .filter((text) => /version/i.test(text)),
          };
        },
        { id: PROBE_ID, path: PDF_PATH, layerId: PROBE_LAYER },
        { timeoutMs: 30_000 },
      );
      expect(shown).toEqual({
        viewType: "zotlit-pdf",
        ours: true,
        status: "ready",
        pageIndex: 1,
        text: true,
        probeLayer: false,
        attached: 0,
        notices: [],
      });
    });
  });
});
