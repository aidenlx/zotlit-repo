import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { discardFixture, getFixtureLayout } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { prepareRunWindow } from "./background-throttling.ts";
import { obRun } from "./obsidian-cli.ts";
import type {
  FileExplorerView,
  PagePdfReaderView,
} from "./page-notes-types.ts";
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

describe.skipIf(!reachable)("ZotLit Reader alone", () => {
  let vaultId = "";

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
});
