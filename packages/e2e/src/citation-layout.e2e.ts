import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MarkdownView } from "obsidian";
import { describe, expect, it } from "vitest";

import type { ReferencesView } from "@zotlit/citations/desktop/references/view.tsx";
import type { CitedByView } from "@zotlit/citations/obsidian/cited-by/view.tsx";

import {
  annotationItem,
  e2eFixture,
  positionDocumentItem,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { EFFECT_MODULE_PATH } from "./effect-module.ts";
import { obRun } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("Citation layout", () => {
  registerEndToEndRunHooks();

  it.each([false, true])(
    "draws small caps and wraps unresolved references with a marker gutter=%s",
    async (gutter) => {
      const styleId = `https://example.org/styles/layout-${gutter}`;
      const stylePath = join(
        e2eFixture.dataDir,
        "styles",
        `layout-${gutter}.csl`,
      );
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(() => rm(stylePath, { force: true }));
      await writeFile(
        stylePath,
        `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text">
<info><title>Layout test ${gutter}</title><id>${styleId}</id><updated>2026-01-01T00:00:00+00:00</updated></info>
<citation><layout><text variable="title"/></layout></citation>
<bibliography${gutter ? ' second-field-align="flush"' : ""}><layout>${gutter ? '<text variable="citation-number" suffix="."/>' : ""}<text variable="title" font-variant="small-caps"/></layout></bibliography>
</style>`,
      );
      const drawing = await obRun(
        run.vaultId,
        async ({ app, page }, { styleId, gutter, citekey }) => {
          await using cleanup = new AsyncDisposableStack();
          const file = cleanup.adopt(
            await app.vault.create(
              `Citation layout ${gutter}.md`,
              `---\nzotlit-csl: ${styleId}\n---\n[@${citekey}; @missing${"x".repeat(100)}]\n`,
            ),
            (file) => app.vault.delete(file),
          );
          const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
            leaf.detach(),
          );
          await leaf.openFile(file, { state: { mode: "preview" } });
          const sidebar = cleanup.adopt(
            app.workspace.getRightLeaf(false)!,
            (leaf) => leaf.detach(),
          );
          await sidebar.setViewState({ type: "zotlit-references" });
          await app.workspace.revealLeaf(sidebar);
          app.workspace.setActiveLeaf(leaf, { focus: true });
          const content = (sidebar.view as ReferencesView).contentEl;
          await page.until(
            "the References Sidebar to render the small-caps bibliography",
            () =>
              [...content.querySelectorAll("span")].some(
                (span) =>
                  span.textContent === "Ten Simple Rules for Better Figures" &&
                  getComputedStyle(span).fontVariantCaps === "small-caps",
              ),
          );
          const list = content.querySelector("ul")!;
          await page.stands(list, "the References list");
          const rows = [...list.querySelectorAll("li")];
          const warning = rows.find((row) =>
            row.textContent.includes("@missing"),
          )!;
          const body = warning.querySelector<HTMLElement>(":scope > div")!;
          return {
            columns:
              getComputedStyle(list).gridTemplateColumns.split(" ").length,
            smallCaps: [...content.querySelectorAll("span")].some(
              (span) =>
                span.textContent === "Ten Simple Rules for Better Figures" &&
                getComputedStyle(span).fontVariantCaps === "small-caps",
            ),
            wrapped:
              body.scrollWidth <= body.clientWidth + 1 &&
              body.getBoundingClientRect().height > 0,
            warning: warning.textContent.includes("⚠"),
          };
        },
        { styleId, gutter, citekey: annotationItem.citationKey },
        { timeoutMs: 60_000 },
      );
      expect(drawing).toEqual({
        columns: gutter ? 3 : 2,
        smallCaps: true,
        wrapped: true,
        warning: gutter,
      });
    },
  );

  it("reveals the Cited By expand button on focus and hover, then shows more context", async () => {
    const drawing = await obRun(
      run.vaultId,
      async ({ app, page }, { citekey }) => {
        await using cleanup = new AsyncDisposableStack();
        const literature = cleanup.adopt(
          await app.vault.create(
            "Layout literature.md",
            "---\nzotero-key: RUGIER24\n---\n",
          ),
          (file) => app.vault.delete(file),
        );
        const source = cleanup.adopt(
          await app.vault.create(
            "Layout source.md",
            `Before the citation.\n\nA reason cites [@${citekey}] here.\n\nMore context follows.\n\nFinal paragraph.`,
          ),
          (file) => app.vault.delete(file),
        );
        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
          leaf.detach(),
        );
        await page.until(
          "the literature note metadata",
          () =>
            app.metadataCache.getFileCache(literature)?.frontmatter?.[
              "zotero-key"
            ] === "RUGIER24",
        );
        await leaf.openFile(literature);
        const sidebar = cleanup.adopt(
          app.workspace.getRightLeaf(false)!,
          (leaf) => leaf.detach(),
        );
        await sidebar.setViewState({
          type: "zotlit-cited-by",
          state: { moreContext: false },
        });
        await app.workspace.revealLeaf(sidebar);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const content = (sidebar.view as CitedByView).contentEl;
        const currentCard = () =>
          content
            .querySelector(`[data-source="${source.path}"]`)
            ?.closest("li")
            ?.querySelector<HTMLElement>("[data-occurrence]");
        const currentChevron = () =>
          currentCard()?.querySelector<HTMLElement>(
            '[data-cited-by-expand="after"]',
          );
        const scrollToCard = () => {
          const card =
            currentChevron()?.closest<HTMLElement>("[data-occurrence]");
          card?.scrollIntoView({ block: "center", behavior: "instant" });
          return card;
        };
        const input = (
          require("@electron/remote") as typeof import("@electron/remote")
        ).getCurrentWebContents().debugger;
        if (!input.isAttached()) {
          input.attach("1.3");
          cleanup.defer(() => input.detach());
        }
        await page.activateLeafWindow(leaf);
        await input.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        });
        (leaf.view as MarkdownView).editor.focus();

        const chevron = await page.until(
          "the inactive expand button to render with zero opacity",
          () => {
            const button = currentChevron();
            return (
              button?.checkVisibility() &&
              getComputedStyle(button).opacity === "0" &&
              button
            );
          },
          15_000,
        );
        const hidden = getComputedStyle(chevron).opacity;
        chevron.focus();
        const focused = await page.until(
          "the focused expand button to be visible",
          () => {
            const button = currentChevron();
            return (
              button?.matches(":focus") &&
              getComputedStyle(button).opacity === "1" &&
              getComputedStyle(button).opacity
            );
          },
        );
        (leaf.view as MarkdownView).editor.focus();

        const card = await page.stands(scrollToCard, "the Cited By card");
        const box = card.getBoundingClientRect();
        await input.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        });
        const hovered = await page.until(
          "the hovered card to show its expand button",
          () => {
            const button = currentChevron();
            return (
              currentCard()?.matches(":hover") &&
              button &&
              getComputedStyle(button).opacity === "1" &&
              getComputedStyle(button).opacity
            );
          },
        );
        const button = await page.stands(currentChevron, "the expand button");
        button.click();
        const expanded = await page.until(
          "the card to show the next paragraph",
          () => currentCard()?.textContent?.includes("More context follows."),
        );
        return { hidden, focused, hovered, expanded };
      },
      { citekey: annotationItem.citationKey },
      { timeoutMs: 60_000 },
    );
    expect(drawing).toEqual({
      hidden: "0",
      focused: "1",
      hovered: "1",
      expanded: true,
    });
  });

  it("draws a muted Cited By status while indexing and uses the error color when a preview fails", async () => {
    const m = await import("@zotlit/plugin-messages/messages.ts");
    const drawing = await obRun(
      run.vaultId,
      async (
        { app, page, zotlit },
        { citekey, indexedKey, indexingText, errorText, effectModulePath },
      ) => {
        await using cleanup = new AsyncDisposableStack();
        const { Stream } = require(
          effectModulePath,
        ) as typeof import("@zotlit/plugin-kernel/effect.ts");
        const { bridge, citationIndex } = zotlit.services;
        const literature = cleanup.adopt(
          await app.vault.create(
            "Status literature.md",
            `---\nzotero-key: ${indexedKey}\n---\n`,
          ),
          (file) => app.vault.delete(file),
        );
        const source = cleanup.adopt(
          await app.vault.create(
            "Status source.md",
            `This note cites [@${citekey}].`,
          ),
          (file) => app.vault.delete(file),
        );
        await page.until(
          "the index to include the citing note",
          async () =>
            (
              await bridge.runPromise(citationIndex.getCitedBy(indexedKey))
            ).groups.some((group) => group.path === source.path),
          15_000,
        );

        const citedBy = citationIndex.citedBy;
        citationIndex.citedBy = (key) =>
          citedBy(key).pipe(
            Stream.map((snapshot) =>
              key === indexedKey
                ? { ...snapshot, coverage: "indexing" as const }
                : snapshot,
            ),
          );
        cleanup.defer(() => {
          citationIndex.citedBy = citedBy;
        });
        const ownCachedRead = Object.getOwnPropertyDescriptor(
          app.vault,
          "cachedRead",
        );
        const cachedRead = app.vault.cachedRead.bind(app.vault);
        app.vault.cachedRead = (file) =>
          file === source
            ? Promise.reject(new Error("Preview source cannot be read"))
            : cachedRead(file);
        cleanup.defer(() => {
          if (ownCachedRead)
            Object.defineProperty(app.vault, "cachedRead", ownCachedRead);
          else Reflect.deleteProperty(app.vault, "cachedRead");
        });

        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
          leaf.detach(),
        );
        await page.until(
          "the literature note metadata",
          () =>
            app.metadataCache.getFileCache(literature)?.frontmatter?.[
              "zotero-key"
            ] === indexedKey,
        );
        await leaf.openFile(literature);
        const sidebar = cleanup.adopt(
          app.workspace.getRightLeaf(false)!,
          (leaf) => leaf.detach(),
        );
        await sidebar.setViewState({ type: "zotlit-cited-by" });
        await app.workspace.revealLeaf(sidebar);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const content = (sidebar.view as CitedByView).contentEl;
        const status = await page.until(
          "the Cited By indexing status",
          () => {
            const strip = content.querySelector<HTMLElement>('[role="status"]');
            const message = [...(strip?.children ?? [])].find(
              (element) => element.textContent === indexingText,
            );
            return strip && message ? { strip, message } : null;
          },
          15_000,
        );
        const warning = await page.until(
          "the citing note's preview error",
          () => {
            const group = content
              .querySelector(`[data-source="${source.path}"]`)
              ?.closest("li");
            return [...(group?.querySelectorAll("span") ?? [])].find(
              (element) => element.textContent === errorText,
            );
          },
          15_000,
        );

        const probe = content.ownerDocument.createElement("span");
        probe.style.backgroundColor = "var(--background-modifier-hover)";
        probe.style.color = "var(--text-normal)";
        content.append(probe);
        cleanup.defer(() => probe.remove());
        const mutedBackground = getComputedStyle(probe).backgroundColor;
        const normalColor = getComputedStyle(probe).color;
        probe.style.color = "var(--text-error)";
        return {
          mutedBackground,
          normalColor,
          errorColor: getComputedStyle(probe).color,
          statusBackground: getComputedStyle(status.strip).backgroundColor,
          statusColor: getComputedStyle(status.message).color,
          previewColor: getComputedStyle(warning).color,
        };
      },
      {
        citekey: positionDocumentItem.citationKey,
        indexedKey: positionDocumentItem.key,
        indexingText: m.cited_by_indexing(),
        errorText: m.cited_by_preview_unavailable(),
        effectModulePath: EFFECT_MODULE_PATH,
      },
      { timeoutMs: 60_000 },
    );
    expect(drawing.mutedBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(drawing.errorColor).not.toBe(drawing.normalColor);
    expect(drawing.statusBackground).toBe(drawing.mutedBackground);
    expect(drawing.statusColor).toBe(drawing.normalColor);
    expect(drawing.previewColor).toBe(drawing.errorColor);
  });
});
