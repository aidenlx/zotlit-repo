import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const markdownParser = unified().use(remarkParse);

function inlineCodeSpans(text: string) {
  const spans: { start: number; end: number }[] = [];
  function collect(node: Nodes) {
    if (node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        spans.push({ start, end });
      }
    }
    if ("children" in node) node.children.forEach(collect);
  }
  collect(markdownParser.parse(text));
  return spans;
}

export function plainMdxText(text: string, source: string): string {
  const prose: string[] = [];
  let cursor = 0;
  for (const { start, end } of inlineCodeSpans(text)) {
    prose.push(text.slice(cursor, start));
    cursor = end;
  }
  prose.push(text.slice(cursor));
  const opener = /[{}<]/.exec(prose.join(" "));
  if (opener) {
    throw new Error(
      `${source} carries the MDX opener ${opener[0]} outside a code span: ${text}`,
    );
  }
  return text;
}
