import type { MenuItem, ReaderHost } from "#/core/host.ts";
import type { ContextTarget } from "#/core/types.ts";
import type { PageView } from "#/core/viewer/viewer.ts";

import { normalizeUnicode } from "@zotlit/pdfjs/lib";

const LOOK_UP_LENGTH = 25;
const TITLE_LENGTH = 40;

export interface MenuSource {
  readonly host: ReaderHost;
  readonly name: string;
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trim()}…`;
}

export function annotationSubpath(pageIndex: number, id: string): string {
  return `#page=${pageIndex + 1}&annotation=${id}`;
}

export function quoteText(
  quote: string | null,
  link: string | null,
  contents?: string,
): string {
  return [quote ? `> ${quote}` : null, link, contents || null]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

export function cleanText(text: string): string {
  return normalizeUnicode(text.replaceAll(/[\n\r]+/g, " ")).replaceAll(
    "\0",
    "",
  );
}

function basename(name: string): string {
  const file = name.slice(name.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

export function pageAlias(source: MenuSource, pageNumber: number): string {
  return source.host.t("pdf_reader_link_alias", {
    name: basename(source.name),
    page: pageNumber,
  });
}

export function sectionAlias(source: MenuSource, title: string): string {
  return source.host.t("pdf_reader_section_alias", {
    name: basename(source.name),
    title,
  });
}

function textInside(element: Element, node: Node): boolean {
  return element === node || element.contains(node);
}

function divOf(divs: readonly HTMLElement[], node: Node): number {
  return divs.findIndex((div) => textInside(div, node));
}

function offsetIn(div: HTMLElement, node: Node, offset: number): number {
  const range = div.ownerDocument.createRange();
  range.setStart(div, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

export function selectionRange(
  view: PageView,
  range: Range,
): readonly [number, number, number, number] | null {
  const divs = view._textHighlighter.textDivs ?? [];
  const start = divOf(divs, range.startContainer);
  const end = divOf(divs, range.endContainer);
  if (start < 0 || end < 0) return null;
  return [
    start,
    offsetIn(divs[start]!, range.startContainer, range.startOffset),
    end,
    offsetIn(divs[end]!, range.endContainer, range.endOffset),
  ];
}

export function builtInItems(
  source: MenuSource,
  target: ContextTarget,
  annotatedText: string | null,
): MenuItem[] {
  const { host } = source;
  const copy = (text: string) => () => {
    void host.copy(text);
  };
  switch (target.kind) {
    case "text": {
      const items: MenuItem[] = [];
      if (host.lookUp) {
        items.push({
          id: "look-up",
          section: "action",
          icon: "lucide-library",
          title: host.t("pdf_reader_look_up", {
            text: truncate(target.text, LOOK_UP_LENGTH),
          }),
          run: () => host.lookUp?.(target.text),
        });
      }
      items.push({
        id: "copy",
        section: "copy",
        icon: "lucide-copy",
        title: host.t("pdf_reader_copy"),
        run: copy(target.text),
      });
      const link = host.link(
        target.subpath,
        pageAlias(source, target.pageIndex + 1),
      );
      if (link === null) return items;
      items.push({
        id: "copy-as-quote",
        section: "copy",
        icon: "lucide-copy",
        title: host.t("pdf_reader_copy_as_quote"),
        run: copy(quoteText(target.text, link)),
      });
      if (target.subpath.includes("&selection=")) {
        items.push({
          id: "copy-selection-link",
          section: "link",
          icon: "lucide-link",
          title: host.t("pdf_reader_copy_selection_link"),
          run: copy(link),
        });
      }
      return items;
    }
    case "pdf-annotation": {
      const link = host.link(
        annotationSubpath(target.pageIndex, target.id),
        pageAlias(source, target.pageIndex + 1),
      );
      if (link === null) return [];
      const items: MenuItem[] = [];
      if (annotatedText) {
        items.push({
          id: "copy-annotation",
          section: "copy",
          icon: "lucide-copy",
          title: host.t("pdf_reader_copy_annotation"),
          run: copy(quoteText(annotatedText, link)),
        });
      }
      items.push({
        id: "copy-annotation-link",
        section: "link",
        icon: "lucide-link",
        title: host.t("pdf_reader_copy_annotation_link"),
        run: copy(link),
      });
      return items;
    }
    case "thumbnail": {
      const page = target.pageIndex + 1;
      const link = host.link(`#page=${page}`, pageAlias(source, page));
      if (link === null) return [];
      return [
        {
          id: "copy-page-link",
          section: "link",
          icon: "lucide-link",
          title: host.t("pdf_reader_copy_page_link", { page }),
          run: copy(link),
        },
      ];
    }
    case "outline": {
      const title = target.title.replaceAll(/\s+/g, " ");
      const link = host.link(target.subpath, sectionAlias(source, title));
      if (link === null) return [];
      return [
        {
          id: "copy-section-link",
          section: "link",
          icon: "lucide-link",
          title: title
            ? host.t("pdf_reader_copy_section_link_title", {
                title: truncate(title, TITLE_LENGTH),
              })
            : host.t("pdf_reader_copy_section_link"),
          run: copy(link),
        },
      ];
    }
    case "page":
      return [];
  }
}
