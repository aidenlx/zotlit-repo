import type { RenderedProperty, RenderedRange } from "#core/render/index.ts";
import type { PreviewCitation } from "#obsidian/view/preview/citations.ts";
import type { WorkbenchMarkdownProps } from "#obsidian/workbench-ui/index.tsx";
import { Effect } from "effect";
import { Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";
import { useEffect, useRef, useState } from "react";

import { citationElement } from "@zotlit/citations/obsidian/citation-text/present.ts";
import {
  replaceCitations,
  sectionCitations,
} from "@zotlit/citations/obsidian/citekey-reading/render.ts";
import { renderCitationRuns } from "@zotlit/citations/obsidian/wikilink-reading/render.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PreviewRenderResult } from "./render.ts";

import { PropertyList } from "#obsidian/workbench-ui/index.tsx";

export function PreviewMarkdown({
  app,
  markdown,
  surface = "note",
  result,
  properties = [],
  frontmatterBlock = null,
  showMarkdown = false,
  expandProperties = false,
  onRendered,
}: {
  app: App;
  markdown: string;
  surface?: WorkbenchMarkdownProps["surface"];
  result: PreviewRenderResult | null;
  marks?: readonly RenderedRange[];
  properties?: readonly RenderedProperty[];
  frontmatterBlock?: string | null;
  showMarkdown?: boolean;
  expandProperties?: boolean;
  onRendered?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedBefore, setExpandedBefore] = useState(expandProperties);
  if (expandedBefore !== expandProperties) {
    setExpandedBefore(expandProperties);
    if (expandProperties) setCollapsed(false);
  }
  const [renderedEmpty, setRenderedEmpty] = useState(false);
  const toggleCollapsed = () => setCollapsed((value) => !value);
  useEffect(() => {
    const element = container.current;
    if (!element || showMarkdown) return;
    element.dataset["zotlitPreviewPending"] = "";
    const pusher = element.createDiv({ cls: "markdown-preview-pusher" });
    const target = element.createDiv();
    target.dataset["zotlitDraft"] = "";
    const footer = element.createDiv({ cls: "mod-footer mod-ui" });
    const lifecycle = new Component();
    let disposed = false;
    lifecycle.load();
    const sourcePath =
      (surface === "annotation"
        ? (result?.annotationSourcePath ?? result?.sourcePath)
        : result?.sourcePath) ?? "";
    void (async () => {
      await MarkdownRenderer.render(
        app,
        markdown,
        target,
        sourcePath,
        lifecycle,
      );
      if (disposed) return;
      let citations =
        surface === "annotation"
          ? (result?.annotationCitations ?? [])
          : (result?.citations ?? []);
      if (
        result &&
        surface !== "annotation" &&
        markdown !== result.creationBody
      ) {
        const offset = result.creationBody?.indexOf(markdown) ?? -1;
        citations =
          offset < 0
            ? []
            : citations.filter(
                ({ start }) =>
                  start >= offset && start < offset + markdown.length,
              );
      }
      presentCitations(target, citations);
      setRenderedEmpty(
        visibleText(target) === "" &&
          target.querySelector("img, svg, video, audio, iframe, input") ===
            null,
      );
      delete element.dataset["zotlitPreviewPending"];
      onRendered?.();
    })().catch((error: unknown) => {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Draft Markdown rendering failed").pipe(
          Effect.annotateLogs({ error }),
          withLogCategory("views", "template-workbench", "preview"),
        ),
      );
      if (!disposed) {
        target.textContent = markdown;
        setRenderedEmpty(false);
        delete element.dataset["zotlitPreviewPending"];
        onRendered?.();
      }
    });
    return () => {
      disposed = true;
      lifecycle.unload();
      pusher.remove();
      target.remove();
      footer.remove();
    };
  }, [app, markdown, surface, result, showMarkdown, onRendered]);
  const present = properties.filter(({ missing }) => !missing);
  const blank = markdown.trim() === "";
  if (showMarkdown) {
    const frontmatter = frontmatterBlock ? `---\n${frontmatterBlock}---\n` : "";
    if (blank && !frontmatter) return <EmptyNote />;
    return (
      <pre className="zt:overflow-x-auto zt:font-mono zt:text-sm zt:[overflow-wrap:anywhere] zt:whitespace-pre-wrap zt:select-text">
        {frontmatter}
        {markdown}
      </pre>
    );
  }
  if (blank && present.length === 0) return <EmptyNote />;
  return (
    <div
      className={cn(
        "markdown-preview-view markdown-rendered show-properties zt-workbench-preview-sheet zt-native-markdown",
        app.vault.getConfig("readableLineLength") && "is-readable-line-width",
      )}
    >
      {present.length > 0 && (
        <div className="markdown-preview-sizer">
          <div className="mod-header mod-ui">
            <div
              className={cn("metadata-container", collapsed && "is-collapsed")}
            >
              <div
                className="metadata-properties-heading"
                role="button"
                tabIndex={0}
                aria-expanded={!collapsed}
                onClick={toggleCollapsed}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleCollapsed();
                  }
                }}
              >
                <div
                  className={cn(
                    "collapse-indicator collapse-icon",
                    collapsed && "is-collapsed",
                  )}
                >
                  <Icon name="right-triangle" />
                </div>
                <div className="metadata-properties-title">
                  {m.workbench_result_properties()}
                </div>
              </div>
              <div className="metadata-content">
                <PropertyList properties={present} variant="note" />
              </div>
            </div>
          </div>
        </div>
      )}
      {blank ? (
        <div className="markdown-preview-sizer">
          <EmptyNote />
        </div>
      ) : (
        <div
          ref={container}
          data-zotlit-preview-pending=""
          hidden={renderedEmpty}
          className="markdown-preview-sizer markdown-preview-section"
        />
      )}
      {!blank && renderedEmpty && (
        <div className="markdown-preview-sizer">
          <EmptyNote />
        </div>
      )}
    </div>
  );
}
function EmptyNote() {
  return (
    <p className="zt:my-6 zt:text-center zt:text-sm zt:text-muted-foreground">
      {m.workbench_result_empty()}
    </p>
  );
}
function compact(value: string): string {
  let text = "";
  for (const character of value) if (character.trim() !== "") text += character;
  return text;
}
function visibleText(element: HTMLElement): string {
  return compact(element.textContent ?? "");
}
export function presentCitations(
  target: HTMLElement,
  formatted: readonly PreviewCitation[],
): void {
  const literal = formatted.filter(({ links }) => links.length === 0);
  let next = 0;
  const citations = sectionCitations(target);
  const matches = citations.map(({ source }) => {
    const index = literal.findIndex(
      (entry, index) => index >= next && entry.source === source,
    );
    if (index < 0) return null;
    next = index + 1;
    return literal[index]!;
  });
  replaceCitations(citations, (_, index) => {
    const value = matches[index];
    return value ? citationElement(target.ownerDocument, value) : null;
  });
  const anchors = [
    ...target.querySelectorAll<HTMLAnchorElement>("a.internal-link"),
  ].filter((anchor) => !anchor.hasAttribute("aria-label"));
  let cursor = 0;
  for (const value of formatted) {
    if (value.links.length === 0) continue;
    const run = [];
    let position = cursor;
    for (const link of value.links) {
      const index = anchors.findIndex(
        (anchor, index) =>
          index >= position && anchor.dataset["href"] === link.target,
      );
      if (index < 0) break;
      position = index + 1;
      run.push({ source: anchors[index]!, citation: link.citation });
    }
    if (run.length !== value.links.length) continue;
    cursor = position;
    renderCitationRuns([run], () => value);
  }
}
