import type { Blocks, Inline, Inlines, QuoteType } from "#core/pandoc/ast.ts";
import { Effect } from "effect";
import type { ReactNode } from "react";
import { createElement, isValidElement } from "react";
import { createRoot } from "react-dom/client";

import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

export interface InlineContentProps {
  nodes: Inlines;
  serials?: readonly (number | undefined)[];
  links?: "render" | "suppress";
}

export function InlineContent(props: InlineContentProps) {
  return <>{renderFlow(props.nodes, contextOf(props))}</>;
}

export function renderInlineContent(
  container: Element,
  props: InlineContentProps,
): void {
  const flow = renderFlow(props.nodes, contextOf(props));
  createRoot(container).render(<>{flow}</>);
  if (flow.length === 0 || container.hasChildNodes()) return;
  Effect.runSyncWith(logServices)(
    Effect.logError("Detached render left the container empty").pipe(
      Effect.annotateLogs({
        inlines: props.nodes.length,
      }),
      withLogCategory("pandoc", "renderer"),
    ),
  );
}

interface Context {
  serials: readonly (number | undefined)[] | undefined;
  links: "render" | "suppress";
}

function contextOf({ serials, links = "render" }: InlineContentProps): Context {
  return { serials, links };
}

export const WRAPPER_TAGS = {
  Emph: "em",
  Strong: "strong",
  Underline: "u",
  Strikeout: "del",
  Superscript: "sup",
  Subscript: "sub",
} as const;

export const QUOTE_MARKS = {
  SingleQuote: ["‘", "’"],
  DoubleQuote: ["“", "”"],
} as const satisfies Record<QuoteType["t"], readonly [string, string]>;

export const DISPLAY_CLASSES = new Set([
  "csl-block",
  "csl-indent",
  "csl-left-margin",
  "csl-right-inline",
]);

const LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

const NO_ENTRY = "⚠";

export function flowWriter<T>(append: (node: T | string) => void) {
  let spaced = true;
  let boundary = false;

  const separate = (): void => {
    if (spaced) return;
    append(" ");
    spaced = true;
  };

  const add = (node: T | string): void => {
    if (boundary) separate();
    boundary = false;
    append(node);
    spaced = false;
  };

  const endPart = (): void => {
    boundary = true;
  };

  return { separate, add, endPart };
}

function renderFlow(nodes: Inlines, context: Context): ReactNode[] {
  const flow: ReactNode[] = [];
  const { separate, add, endPart } = flowWriter<ReactNode>((node) => {
    flow.push(node);
  });
  let key = 0;

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Str":
          add(inline.c);
          break;
        case "Space":
        case "SoftBreak":
          separate();
          break;
        case "LineBreak":
          add(<br key={key++} />);
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
          add(
            createElement(
              WRAPPER_TAGS[inline.t],
              { key: key++ },
              renderFlow(inline.c, context),
            ),
          );
          break;
        case "SmallCaps":
          add(
            <span key={key++} className="zt:[font-variant:small-caps]">
              {renderFlow(inline.c, context)}
            </span>,
          );
          break;
        case "Quoted": {
          const [open, close] = QUOTE_MARKS[inline.c[0].t];
          add(open);
          walk(inline.c[1]);
          add(close);
          break;
        }
        case "Code": {
          const [, source] = inline.c;
          add(<code key={key++}>{source}</code>);
          break;
        }
        case "Math": {
          const [, source] = inline.c;
          add(source);
          break;
        }
        case "Cite": {
          const [, content] = inline.c;
          walk(content);
          break;
        }
        case "Image": {
          const [, alt] = inline.c;
          walk(alt);
          break;
        }
        case "Span": {
          const [[, classes], content] = inline.c;
          const display = classes.some((name) => DISPLAY_CLASSES.has(name));
          if (display) separate();
          walk(content);
          if (display) endPart();
          break;
        }
        case "Link": {
          const [, children, [url, title]] = inline.c;
          if (context.links === "suppress") {
            add(plainText(children, context));
            break;
          }
          const href = linkHref(url);
          if (href === null) {
            walk(children);
            break;
          }
          add(
            <a key={key++} href={href} {...(title ? tooltipAttrs(title) : {})}>
              {renderFlow(children, context)}
            </a>,
          );
          break;
        }
        case "Note": {
          const { serials } = context;
          if (!serials?.length) {
            Effect.runSyncWith(logServices)(
              Effect.logDebug(
                "Dropped a note with no serial to stand for it",
              ).pipe(
                Effect.annotateLogs({
                  inline: inline.t,
                }),
                withLogCategory("pandoc", "renderer"),
              ),
            );
            break;
          }
          add(
            <sup key={key++} className={themeHook.entrySerial}>
              {serials.map((serial) => serial ?? NO_ENTRY).join(",")}
            </sup>,
          );
          break;
        }
        case "RawInline":
          Effect.runSyncWith(logServices)(
            Effect.logDebug("Dropped an inline the renderer cannot show").pipe(
              Effect.annotateLogs({
                inline: inline.t,
                format: inline.c[0],
              }),
              withLogCategory("pandoc", "renderer"),
            ),
          );
          break;
      }
    }
  }

  walk(nodes);
  return flow;
}

export function holdsNote(nodes: Inlines): boolean {
  return nodes.some((inline) => {
    switch (inline.t) {
      case "Note":
        return true;
      case "Emph":
      case "Strong":
      case "Underline":
      case "Strikeout":
      case "Superscript":
      case "Subscript":
      case "SmallCaps":
        return holdsNote(inline.c);
      case "Quoted":
      case "Cite":
      case "Link":
      case "Image":
      case "Span":
        return holdsNote(inline.c[1]);
      default:
        return false;
    }
  });
}

export function noteContent(nodes: Inlines): Inlines {
  const flow: Inline[] = [];

  function addBlocks(blocks: Blocks): void {
    for (const block of blocks) {
      switch (block.t) {
        case "Plain":
        case "Para":
          if (flow.length > 0) flow.push({ t: "Space" });
          flow.push(...block.c);
          break;
        default:
          Effect.runSyncWith(logServices)(
            Effect.logDebug(
              "Dropped a note block that reads as no inline flow",
            ).pipe(
              Effect.annotateLogs({
                block: block.t,
              }),
              withLogCategory("pandoc", "renderer"),
            ),
          );
      }
    }
  }

  function walk(inlines: Inlines): void {
    for (const inline of inlines) {
      switch (inline.t) {
        case "Note":
          addBlocks(inline.c);
          break;
        case "Emph":
        case "Strong":
        case "Underline":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
        case "SmallCaps":
          walk(inline.c);
          break;
        case "Quoted":
        case "Cite":
        case "Link":
        case "Image":
        case "Span":
          walk(inline.c[1]);
          break;
        default:
          break;
      }
    }
  }

  walk(nodes);
  return flow;
}

export function inlineText(nodes: Inlines): string {
  return plainText(nodes, contextOf({ nodes }));
}

function plainText(inlines: Inlines, context: Context): string {
  return textOf(renderFlow(inlines, context));
}

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

export function linkHref(url: string): string | null {
  const target = URL.parse(url);
  return target && LINK_SCHEMES.has(target.protocol) ? url : null;
}
