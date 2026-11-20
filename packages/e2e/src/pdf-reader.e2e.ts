import type ReaderProbePlugin from "@e2e-fixtures/reader-probe-plugin/main.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { e2eVaultPath, reachable, workspaceRoot } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import {
  installReaderProbe,
  PROBE_ID,
  PROBE_LAYER,
  PROBE_VIEW_TYPE,
  removeReaderProbe,
} from "./reader-probe.ts";

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
const squeeze = (text: string) => text.replaceAll(/\s+/g, "");
interface Registries {
  readonly viewRegistry: { typeByExtension: Record<string, string> };
  readonly embedRegistry: { embedByExtension: Record<string, unknown> };
}

const DISPLAY_ENTRIES = [
  "Fit width",
  "Fit height",
  "Single page",
  "Two-page (odd)",
  "Two-page (even)",
  "Adapt to theme",
];

describe.skipIf(!reachable)("End-to-end Run", () => {
  registerEndToEndRunHooks();

  describe("the PDF reader in a plugin with no Zotero features", () => {
    beforeAll(async () => {
      await installReaderProbe(workspaceRoot, e2eVaultPath);
      await obRun(
        run.vaultId,
        async ({ app }, { id }) => {
          await app.plugins.loadManifests();
          await app.plugins.enablePlugin(id);
        },
        { id: PROBE_ID },
      );
      await obRunUntil(
        run.vaultId,
        async ({ app }, { id }) => {
          const probe = app.plugins.plugins[id] as
            | ReaderProbePlugin
            | undefined;
          return probe?.pdf !== null && probe?.pdf !== undefined;
        },
        { id: PROBE_ID },
        { what: "the reader probe plugin to register its reader" },
      );
    });

    afterAll(async () => {
      await obRun(
        run.vaultId,
        async ({ app }, { id }) => {
          await app.plugins.disablePlugin(id);
        },
        { id: PROBE_ID },
      );
      await removeReaderProbe(e2eVaultPath);
    });

    it("opens a PDF in its own view, draws its layer and keeps the layer through a zoom", async () => {
      const opened = await obRun(
        run.vaultId,
        async ({ app }, { id, path, layerId }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const file = app.vault.getFileByPath(path)!;
          const view = await probe.pdf!.open(file, {
            subpath: "#page=2",
            pane: "tab",
          });
          if (view) cleanup.adopt(view.leaf, (leaf) => leaf.detach());
          const reader = view?.reader ?? null;
          if (!view || !reader) return null;
          const document = await reader.whenReady();
          const rendered = await reader.whenRendered(1);
          await reader.settled();
          const layerOf = () =>
            reader
              .pageAt(1)
              ?.div.querySelector<HTMLElement>(
                `[data-zpr-layer="${layerId}"]`,
              ) ?? null;
          const layer = layerOf();
          const drawn = probe.drawn;
          const repainted = new Promise<void>((resolve) => {
            const off = reader.on("page-rendered", ({ page }) => {
              if (page.pageIndex !== 1) return;
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
            kind: reader.kind,
            ready: document !== null,
            painted: rendered !== null,
            pageIndex: reader.state.get().pageIndex,
            attached: probe.attached.at(-1) ?? null,
            band: layer?.querySelector(".probe-band") !== null,
            fonts: [...view.containerEl.doc.fonts].some((face) =>
              face.family.includes(`g_${id}`),
            ),
            scale: reader.state.get().scale,
            sameLayer: layer !== null && zoomed === layer,
            bandAfterZoom: zoomed?.querySelector(".probe-band") !== null,
            redrawn: probe.drawn > drawn,
          };
        },
        { id: PROBE_ID, path: PDF_PATH, layerId: PROBE_LAYER },
        { timeoutMs: 30_000 },
      );
      expect(opened).toEqual({
        viewType: PROBE_VIEW_TYPE,
        kind: "view",
        ready: true,
        painted: true,
        pageIndex: 1,
        attached: { kind: "view", subpath: "#page=2", restored: false },
        band: true,
        fonts: true,
        scale: 2,
        sameLayer: true,
        bandAfterZoom: true,
        redrawn: true,
      });
    });

    it("renders side by side with ZotLit's own reader, each with its own fonts (E-20)", async () => {
      const both = await obRun(
        run.vaultId,
        async ({ app, zotlit, page }, { id, path, layerId }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const s = zotlit.services;
          const registration = s.pdfReaderPort.registration!;
          const file = app.vault.getFileByPath(path)!;
          const probeView = (await probe.pdf!.open(file, { pane: "tab" }))!;
          cleanup.adopt(probeView.leaf, (leaf) => leaf.detach());
          const probeReader = await page.until(
            "the probe reader",
            () => probeView.reader,
          );
          await probeReader.whenReady();
          await probeReader.settled();
          const known = new Set(registration.views());
          await s.bridge.runPromise(s.pdfReader.open(file, "", "tab"));
          const zotlitView = registration
            .views()
            .find((view) => view.file === file && !known.has(view))!;
          cleanup.adopt(zotlitView.leaf, (leaf) => leaf.detach());
          const zotlitReader = await page.until(
            "the ZotLit reader",
            () => zotlitView.reader,
          );
          await zotlitReader.whenReady();
          await zotlitReader.settled();
          const families = [...app.workspace.containerEl.doc.fonts].map(
            (face) => face.family,
          );
          const layer = `[data-zpr-layer="${layerId}"]`;
          return {
            probeFonts: families.some((family) =>
              new RegExp(`^g_${id}\\d+_s?f\\d+$`).test(family),
            ),
            zotlitFonts: families.some((family) =>
              /^g_zotlit\d+_s?f\d+$/.test(family),
            ),
            probeLayer: probeReader.root.querySelector(layer) !== null,
            zotlitLayer: zotlitReader.root.querySelector(layer) !== null,
            bothShown:
              probeReader.state.get().status === "ready" &&
              zotlitReader.state.get().status === "ready",
          };
        },
        { id: PROBE_ID, path: PDF_PATH, layerId: PROBE_LAYER },
        { timeoutMs: 30_000 },
      );
      expect(both).toEqual({
        probeFonts: true,
        zotlitFonts: true,
        probeLayer: true,
        zotlitLayer: false,
        bothShown: true,
      });
    });

    it("pages with the arrow keys in a fit mode, lists its display modes and keeps one reader for a later link", async () => {
      const keyed = await obRun(
        run.vaultId,
        async ({ app, page }, { id, path, entries }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const file = app.vault.getFileByPath(path)!;
          const view = (await probe.pdf!.open(file, {
            subpath: "#page=2",
            pane: "tab",
          }))!;
          cleanup.adopt(view.leaf, (leaf) => leaf.detach());
          const reader = view.reader!;
          await reader.whenReady();
          await reader.settled();
          app.workspace.setActiveLeaf(view.leaf, { focus: true });
          reader.focus();
          await page.trusted(view.containerEl.win).key("Right");
          await page.until("the next page", () =>
            reader.state.get().pageIndex === 2 ? true : false,
          );
          const { subpath } = view.getEphemeralState();
          const readers = probe.attached.length;
          const again = await probe.pdf!.open(file, { subpath: "#page=5" });
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
            sameView: again === view,
            newReaders: probe.attached.length - readers,
            titles,
            zoom: reader.state.get().zoom,
          };
        },
        { id: PROBE_ID, path: PDF_PATH, entries: DISPLAY_ENTRIES },
        { timeoutMs: 30_000 },
      );
      expect(keyed).toEqual({
        subpath: "#page=3",
        sameView: true,
        newReaders: 0,
        titles: DISPLAY_ENTRIES,
        zoom: "page-height",
      });
    });

    it("adapts its pages to the Obsidian theme and repaints them when the theme changes, also in a background tab", async () => {
      const themed = await obRun(
        run.vaultId,
        async ({ app, page }, { id, path }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const file = app.vault.getFileByPath(path)!;
          const theme = app.vault.getConfig("theme");
          cleanup.defer(() => app.changeTheme(theme));
          app.changeTheme("moonstone");
          const view = (await probe.pdf!.open(file, {
            subpath: "#page=1",
            pane: "tab",
          }))!;
          cleanup.adopt(view.leaf, (leaf) => leaf.detach());
          const reader = view.reader!;
          cleanup.defer(() => reader.set({ themed: false }));
          await reader.whenReady();
          await reader.whenRendered(0);
          await reader.settled();
          const lightness = (x: number, y: number) => {
            const target = reader.pageAt(0)!;
            const canvas = target.div.querySelector("canvas")!;
            const [vx = 0, vy = 0] = target.viewport.convertToViewportPoint(
              x,
              y,
            );
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
        { id: PROBE_ID, path: THEME_PDF },
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
      const forkFonts = join(
        workspaceRoot,
        "packages/pdfjs/dist/standard_fonts",
      );
      const fetched = await obRun(
        run.vaultId,
        async ({ app }, { id, pdf }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
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
          const document = await probe.pdf!.engine.load({
            key: "standard-fonts.pdf",
            name: "standard-fonts.pdf",
            read: async () =>
              Uint8Array.from(atob(pdf), (char) => char.charCodeAt(0)),
          });
          cleanup.defer(() => document[Symbol.asyncDispose]());
          const page = (await document.page(0))!;
          const viewport = page.getViewport({ scale: 1 });
          const canvas = activeDocument.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({ canvas, viewport }).promise;
          return requests;
        },
        { id: PROBE_ID, pdf: bytes.toString("base64") },
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

    it("takes over PDF opens, embeds, hover previews and canvas cards, and gives them back", async () => {
      const taken = await obRun(
        run.vaultId,
        async (
          { app, page },
          { id, path, note, canvasFile, layerId, viewType },
        ) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const registries = app as unknown as Registries;
          const saved = {
            viewType: registries.viewRegistry.typeByExtension.pdf,
            creator: registries.embedRegistry.embedByExtension.pdf,
          };
          const state = probe.pdf!.setTakeover(true);
          cleanup.defer(() => {
            probe.pdf!.setTakeover(false);
          });

          const opened = cleanup.adopt(app.workspace.getLeaf("tab"), (tab) =>
            tab.detach(),
          );
          await opened.openFile(app.vault.getFileByPath(path)!);
          await page.until("the opened PDF's reader", () =>
            probe.pdf!.readerOf(opened.view),
          );
          const explorer = {
            state,
            observed: probe.pdf!.takeover.get(),
            mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
            opened: opened.view.getViewType() === viewType,
            attached: probe.attached.at(-1) ?? null,
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
              `the drawn layer of ${src}`,
              () =>
                embed.querySelector(
                  `[data-zpr-layer="${layerId}"] .probe-band`,
                ),
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
            "the hover preview's drawn layer",
            () =>
              popover.querySelector(
                `[data-zpr-layer="${layerId}"] .probe-band`,
              ),
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
          await probe.render({
            markdown: "![[excerpt-rendering.pdf#page=2]]",
            element,
            sourcePath: note,
            component: noteLeaf.view,
          });
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

          const canvasLeaf = cleanup.adopt(
            app.workspace.getLeaf("tab"),
            (tab) => tab.detach(),
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
          const container = card.closest<HTMLElement>(
            ".canvas-node-container",
          )!;
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

          const restored = probe.pdf!.setTakeover(false);
          const given = {
            state: restored,
            mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
            sameView:
              saved.viewType === registries.viewRegistry.typeByExtension.pdf,
            sameEmbed:
              saved.creator === registries.embedRegistry.embedByExtension.pdf,
          };
          return {
            explorer,
            embeds,
            hover,
            livePreview,
            printed,
            canvas,
            farKind,
            given,
          };
        },
        {
          id: PROBE_ID,
          path: PDF_PATH,
          note: EMBEDS_NOTE,
          canvasFile: EMBEDS_CANVAS,
          layerId: PROBE_LAYER,
          viewType: PROBE_VIEW_TYPE,
        },
        { timeoutMs: 60_000 },
      );
      expect(taken).toEqual({
        explorer: {
          state: "on",
          observed: "on",
          mapped: PROBE_VIEW_TYPE,
          opened: true,
          attached: { kind: "view", subpath: null, restored: false },
        },
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
        given: { state: "off", mapped: "pdf", sameView: true, sameEmbed: true },
      });
    });

    it("moves an embed's reader with its note into a pop-out window", async () => {
      const moved = await obRun(
        run.vaultId,
        async ({ app, page }, { id, note }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          probe.pdf!.setTakeover(true);
          cleanup.defer(() => {
            probe.pdf!.setTakeover(false);
          });
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
          const before = probe.migrated.length;
          app.workspace.moveLeafToPopout(leaf);
          const popout = await page.until(
            "the note in a pop-out window",
            () => {
              const { win } = leaf.view.containerEl;
              return win === window ? null : win;
            },
            10000,
          );
          const migrated = await page.until(
            "the embed's reader to follow its note",
            () =>
              probe.migrated
                .slice(before)
                .find((entry) => entry.kind === "embed") ?? null,
            10000,
          );
          return {
            sameRoot: root.isConnected && root.doc === popout.document,
            toPopout: migrated.window === popout,
          };
        },
        { id: PROBE_ID, note: EMBEDS_NOTE },
        { timeoutMs: 30_000 },
      );
      expect(moved).toEqual({ sameRoot: true, toPopout: true });
    });

    it("highlights the text of a #selection= link made in Obsidian's own PDF view, as that view does", async () => {
      const shown = await obRun(
        run.vaultId,
        async ({ app, page }, { id, note, links, past }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const written = await app.vault.cachedRead(
            app.vault.getFileByPath(note)!,
          );
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
            const view = (await probe.pdf!.open(file, {
              subpath,
              pane: "tab",
            }))!;
            cleanup.adopt(view.leaf, (tab) => tab.detach());
            const reader = await page.until("the reader", () => view.reader);
            await reader.whenReady();
            await reader.settled();
            const marks = [
              ...reader.container.querySelectorAll(
                '[data-zpr-highlight="text"]',
              ),
            ];
            results.push({
              onPage: written.includes(`[[${path}${subpath}\\|`),
              obsidianView: leaf.view.getViewType(),
              obsidian,
              reader: marks.map((mark) => mark.textContent).join(""),
            });
          }
          const view = (await probe.pdf!.open(
            app.vault.getFileByPath(past.path)!,
            { subpath: past.subpath, pane: "tab" },
          ))!;
          cleanup.adopt(view.leaf, (tab) => tab.detach());
          const reader = await page.until("the reader", () => view.reader);
          await reader.whenReady();
          await reader.settled();
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
        {
          id: PROBE_ID,
          note: SELECTION_NOTE,
          links: OBSIDIAN_SELECTIONS,
          past: PAST_THE_PAGE,
        },
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

    it("copies a link to a selection that Obsidian's own PDF view highlights the same way", async () => {
      const copied = await obRun(
        run.vaultId,
        async ({ app, page }, { id, selections }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const results = [];
          for (const { path, pageIndex, wanted } of selections) {
            const file = app.vault.getFileByPath(path)!;
            const view = (await probe.pdf!.open(file, {
              subpath: `#page=${pageIndex + 1}`,
              pane: "tab",
            }))!;
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
          id: PROBE_ID,
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

    it("gives PDFs back to Obsidian when the plugin unloads with the takeover on", async () => {
      const unloaded = await obRun(
        run.vaultId,
        async ({ app, page }, { id, path }) => {
          await using cleanup = new AsyncDisposableStack();
          const probe = app.plugins.plugins[id] as ReaderProbePlugin;
          const registries = app as unknown as Registries;
          const creator = registries.embedRegistry.embedByExtension.pdf;
          const view = (await probe.pdf!.open(app.vault.getFileByPath(path)!, {
            pane: "tab",
          }))!;
          cleanup.adopt(view.leaf, (leaf) => leaf.detach());
          const reader = await page.until(
            "the reader that mounts after the open",
            () => view.reader,
          );
          await reader.whenReady();
          cleanup.defer(async () => {
            await app.plugins.enablePlugin(id);
            await page.until(
              "the reader probe plugin to register its reader again",
              () =>
                (app.plugins.plugins[id] as ReaderProbePlugin | undefined)
                  ?.pdf ?? null,
            );
          });
          probe.pdf!.setTakeover(true);
          cleanup.defer(() => {
            probe.pdf!.setTakeover(false);
          });
          await app.plugins.disablePlugin(id);
          return {
            mapped: registries.viewRegistry.typeByExtension.pdf ?? null,
            sameEmbed:
              creator === registries.embedRegistry.embedByExtension.pdf,
            readerGone: !reader.root.isConnected,
            readerDisposed: reader.pageAt(0) === null,
          };
        },
        { id: PROBE_ID, path: PDF_PATH },
        { timeoutMs: 30_000 },
      );
      expect(unloaded).toEqual({
        mapped: "pdf",
        sameEmbed: true,
        readerGone: true,
        readerDisposed: true,
      });
    });
  });
});
