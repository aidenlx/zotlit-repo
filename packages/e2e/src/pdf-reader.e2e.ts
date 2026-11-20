import type ReaderProbePlugin from "@e2e-fixtures/reader-probe-plugin/main.ts";
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
  });
});
