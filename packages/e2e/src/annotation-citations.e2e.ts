import { describe, expect, it } from "vitest";

import {
  annotationAttachment,
  attachmentAnnotations,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";

const NOTE = "Annotation citations.md";

const FIRST_PAGE = attachmentAnnotations.find(({ key }) => key === "PUPR5FG5")!;

const URL = `zotero://open/library/items/${annotationAttachment.key}?annotation=${FIRST_PAGE.key}&page=${FIRST_PAGE.pageLabel}`;

interface CitationLook {
  shown: string;
  popover: {
    annotation: boolean;
    quote: string;
    references: number;
    actions: number;
  };
}

async function look({
  gesture,
  render,
  hoverAction = "popover",
}: {
  gesture: "live-preview" | "reading";
  render: boolean;
  hoverAction?: "off" | "popover" | "page-preview";
}): Promise<CitationLook> {
  return obRun(
    run.vaultId,
    async (
      { zotlit, page },
      { notePath, url, noteGesture, renderCitations, hover, quote },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      await using cleanup = new AsyncDisposableStack();
      links.applySettings(cleanup, {
        "citation.annotation-citations": true,
        "citation.render-annotation-citations": renderCitations,
        "citation.hover-action": hover,
      });
      const { view } = await links.showNote(cleanup, {
        notePath,
        content: `# Draft\n\nAs Rougier argues [](${url}).\n`,
        gesture: noteGesture,
      });
      const shownLine = () =>
        noteGesture === "reading"
          ? (view.previewMode.containerEl
              .querySelector<HTMLAnchorElement>(`a[href="${url}"]`)
              ?.closest("p") ?? null)
          : ([
              ...view.editor.cm.contentDOM.querySelectorAll<HTMLElement>(
                ".cm-line",
              ),
            ].find((line) => line.textContent?.startsWith("As Rougier")) ??
            null);
      const target = await until(
        () => {
          const line = shownLine();
          if (!line) return null;
          if (!renderCitations)
            return line.querySelector<HTMLElement>(
              noteGesture === "reading"
                ? `a[href="${url}"]`
                : ".zt-annotation-link .cm-link",
            );
          return line.textContent?.includes("Rougier", "As Rougier".length)
            ? line.querySelector<HTMLElement>(".zt-annotation-citation")
            : null;
        },
        () =>
          `The link did not render: ${shownLine()?.outerHTML.slice(0, 300)}`,
      );
      const shown = shownLine()!.textContent ?? "";
      cleanup.defer(() => view.hoverPopover?.hide());
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          clientX: box.left + 2,
          clientY: box.top + box.height / 2,
          view: target.ownerDocument.defaultView,
        }),
      );
      const content = await until(
        () =>
          view.hoverPopover?.hoverEl.querySelector<HTMLElement>(
            ".zt-citation-popover-content",
          ),
        () => "No popover opened over the link",
      );
      await until(
        () => content.textContent?.includes(quote),
        () => `The popover never showed the Annotation: ${content.textContent}`,
      );
      await until(
        () => content.querySelector("[data-citation-popover-actions]"),
        () => `The popover never showed the reference: ${content.textContent}`,
      );
      return {
        shown,
        popover: {
          annotation: content.querySelector("[data-annotation-key]") !== null,
          quote: content.textContent ?? "",
          references: content.querySelectorAll("[data-citation-popover-block]")
            .length,
          actions: content.querySelectorAll(
            "[data-citation-popover-actions] .clickable-icon",
          ).length,
        },
      };
    },
    {
      notePath: NOTE,
      url: URL,
      noteGesture: gesture,
      renderCitations: render,
      hover: hoverAction,
      quote: FIRST_PAGE.text!,
    },
    { timeoutMs: 90000 },
  );
}

describe.skipIf(!reachable)("Annotation Citations", () => {
  registerEndToEndRunHooks();

  it.each(["live-preview", "reading"] as const)(
    "stay links, and hover with the Annotation and the reference, while the setting is off, in %s",
    async (gesture) => {
      const outcome = await look({ gesture, render: false });

      expect(outcome.shown).not.toContain("2014");
      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
      expect(outcome.popover.quote).toContain("Ten Simple Rules");
      expect(outcome.popover.actions).toBeGreaterThanOrEqual(3);
    },
    120000,
  );

  it.each(["live-preview", "reading"] as const)(
    "show as the Item's citation at the Annotation's page, and hover with the Annotation and the reference, in %s",
    async (gesture) => {
      const outcome = await look({ gesture, render: true });

      expect(outcome.shown).toMatch(
        new RegExp(`\\(Rougier .*2014, ${FIRST_PAGE.pageLabel}\\)`),
      );
      expect(outcome.shown).not.toContain("zotero://");
      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
      expect(outcome.popover.quote).toContain("Ten Simple Rules");
      expect(outcome.popover.actions).toBeGreaterThanOrEqual(3);
    },
    120000,
  );

  it.each(["off", "page-preview"] as const)(
    "hover with the Annotation and the reference whatever the Hover action, under %s",
    async (hoverAction) => {
      const outcome = await look({
        gesture: "live-preview",
        render: true,
        hoverAction,
      });

      expect(outcome.popover).toMatchObject({
        annotation: true,
        references: 1,
      });
      expect(outcome.popover.quote).toContain(FIRST_PAGE.text);
    },
    120000,
  );
});
