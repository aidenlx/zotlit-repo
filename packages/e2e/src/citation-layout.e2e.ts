import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MarkdownView } from "obsidian";
import { describe, expect, it } from "vitest";

import type { ReferencesView } from "@zotlit/citations/desktop/references/view.tsx";
import type { CitedByView } from "@zotlit/citations/obsidian/cited-by/view.tsx";

import { annotationItem, e2eFixture, reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
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
        const chevron = await page
          .until(
            "the source card to offer more context",
            () => {
              const group = content
                .querySelector(`[data-source="${source.path}"]`)
                ?.closest("li");
              return group?.querySelector<HTMLElement>(
                '[data-cited-by-expand="after"]',
              );
            },
            15_000,
          )
          .catch((error: unknown) => {
            throw new Error(
              `${String(error)}; sidebar: ${content.textContent}`,
              { cause: error },
            );
          });
        const card = chevron.closest<HTMLElement>("[data-occurrence]")!;
        const input = (
          require("@electron/remote") as typeof import("@electron/remote")
        ).getCurrentWebContents().debugger;
        if (!input.isAttached()) {
          input.attach("1.3");
          cleanup.defer(() => input.detach());
        }
        await page.activateLeafWindow(leaf);
        card.scrollIntoView({ block: "center", behavior: "instant" });
        await page.stands(card, "the Cited By card");
        await input.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: 1,
          y: 1,
        });
        (leaf.view as MarkdownView).editor.focus();
        await page.until(
          "the inactive expand button to be hidden",
          () => getComputedStyle(chevron).opacity === "0",
        );
        const hidden = getComputedStyle(chevron).opacity;
        chevron.focus();
        await page.until(
          "the focused expand button to be visible",
          () => getComputedStyle(chevron).opacity === "1",
        );
        const focused = getComputedStyle(chevron).opacity;
        chevron.blur();
        const box = card.getBoundingClientRect();
        await input.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        });
        await page.until(
          "the hovered expand button to be visible",
          () => getComputedStyle(chevron).opacity === "1",
        );
        const hovered = getComputedStyle(chevron).opacity;
        chevron.click();
        await page.until("the card to show the next paragraph", () =>
          card.textContent?.includes("More context follows."),
        );
        return {
          hidden,
          focused,
          hovered,
          expanded: card.textContent?.includes("More context follows."),
        };
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
});
