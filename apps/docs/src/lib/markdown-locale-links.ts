import type { Definition, Link as MarkdownLink, Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { SiteLocale } from "./i18n.ts";
import { chinesePrefix, unlocalizedPath } from "./i18n.ts";
import { isMarkdownSection } from "./markdown-routes.ts";
import { changelogFeedRoute } from "./shared.ts";

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function isLocalizedSectionPath(path: string) {
  const [, head = "", ...rest] = path.split("/");
  const section = rest.length === 0 ? head.replace(/\.md$/, "") : head;
  return isMarkdownSection(section) || section === "llms.mdx";
}

function destinationStart(markdown: string, node: MarkdownLink | Definition) {
  const start =
    node.type === "link"
      ? (node.children.at(-1)?.position?.end.offset ??
        (node.position?.start.offset ?? -1) + 1)
      : node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || start < 0 || end === undefined) return undefined;
  const remainder = markdown.slice(start, end);
  const prefix =
    node.type === "link"
      ? /^\]\(\s*<?/.exec(remainder)
      : /^\[(?:\\.|[^\]\\])*\]:\s*<?/.exec(remainder);
  return prefix ? start + prefix[0].length : undefined;
}

function localePrefixEnd(markdown: string, start: number) {
  let end = start;
  let decoded = "";
  while (decoded.length < chinesePrefix.length && end < markdown.length) {
    if (
      markdown[end] === "\\" &&
      /[!-/:-@[-`{-~]/.test(markdown.charAt(end + 1))
    ) {
      end++;
    }
    decoded += markdown.charAt(end++);
  }
  return decoded === chinesePrefix ? end : undefined;
}

export function localizeMarkdownLinks(markdown: string, locale: SiteLocale) {
  const tree = markdownParser.parse(markdown);
  const links: (MarkdownLink | Definition)[] = [];
  const references = new Set<string>();
  const imageReferences = new Set<string>();
  function collect(node: Nodes) {
    if (node.type === "link" || node.type === "definition") links.push(node);
    if (node.type === "linkReference") references.add(node.identifier);
    if (node.type === "imageReference") imageReferences.add(node.identifier);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);

  const edits: { start: number; remove: number; value: string }[] = [];
  for (const node of links) {
    if (
      node.type === "definition" &&
      (!references.has(node.identifier) || imageReferences.has(node.identifier))
    ) {
      continue;
    }
    if (!node.url.startsWith("/") || node.url.startsWith("//")) continue;
    const url = new URL(node.url, "https://zotlit.invalid");
    if (url.origin !== "https://zotlit.invalid") continue;
    const pathname = url.pathname;
    const canonical = unlocalizedPath(pathname);
    if (
      !isLocalizedSectionPath(canonical) ||
      canonical === changelogFeedRoute
    ) {
      continue;
    }
    const hasPrefix = pathname !== canonical;
    if (hasPrefix === (locale === "zh-CN")) continue;
    const start = destinationStart(markdown, node);
    if (
      start === undefined ||
      (markdown[start] !== "/" && !markdown.startsWith("\\/", start))
    ) {
      continue;
    }
    const end = hasPrefix ? localePrefixEnd(markdown, start) : start;
    if (end === undefined) continue;
    edits.push({
      start,
      remove: end - start,
      value: locale === "zh-CN" ? chinesePrefix : "",
    });
  }
  let localized = markdown;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    localized =
      localized.slice(0, edit.start) +
      edit.value +
      localized.slice(edit.start + edit.remove);
  }
  return localized;
}
