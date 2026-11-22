import type {
  DocRange,
  TokenNode,
} from "@zotlit/obsidian-kit/editor-decoration.ts";

export interface WikilinkSpan {
  isEmbed: boolean;
  hasAlias: boolean;
  inner: DocRange;
  outer: DocRange;
  group: DocRange;
  linktext: string;
  tokenClasses: readonly string[];
}

const LINK_START = "formatting-link-start";
const LINK_END = "formatting-link-end";
const EMBED_OPENER = "formatting-embed";
const INTERNAL_LINK = "hmd-internal-link";

const GROUP_CLASSES: ReadonlySet<string> = new Set([
  "em",
  "strong",
  "inline-code",
  "strikethrough",
  "highlight",
  "link",
  "image",
  "hmd-internal-link",
  "hmd-embed",
  "formatting-link",
  "footref",
]);

interface OpenRun {
  isEmbed: boolean;
  outerFrom: number;
  innerFrom: number;
  innerTo: number;
  raw: string;
  tokenClasses: readonly string[] | null;
}

export function scanWikilinks(nodes: readonly TokenNode[]): WikilinkSpan[] {
  const groups = concealGroups(nodes);
  const spans: WikilinkSpan[] = [];
  let run: OpenRun | null = null;

  for (const node of nodes) {
    const classes = new Set(node.classes);
    if (classes.has(LINK_START)) {
      run = {
        isEmbed: classes.has(EMBED_OPENER),
        outerFrom: node.from,
        innerFrom: node.to,
        innerTo: node.to,
        raw: "",
        tokenClasses: null,
      };
      continue;
    }
    if (run === null) continue;
    if (classes.has(INTERNAL_LINK)) {
      run.raw += node.text;
      run.innerTo = node.to;
      run.tokenClasses ??= node.classes;
      continue;
    }
    if (classes.has(LINK_END) && run.raw !== "") {
      spans.push(closeRun(run, node.to, groups));
    }
    run = null;
  }
  return spans;
}

function closeRun(
  run: OpenRun,
  outerTo: number,
  groups: readonly DocRange[],
): WikilinkSpan {
  const outer = { from: run.outerFrom, to: outerTo };
  return {
    isEmbed: run.isEmbed,
    hasAlias: run.raw.includes("|"),
    inner: { from: run.innerFrom, to: run.innerTo },
    outer,
    group: groupAround(groups, outer),
    linktext: hrefOf(run.raw),
    tokenClasses: run.tokenClasses ?? [],
  };
}

function hrefOf(raw: string): string {
  const pipe = raw.indexOf("|");
  if (pipe === -1) return raw.trim().normalize("NFC");
  const end = raw.charAt(pipe - 1) === "\\" ? pipe - 1 : pipe;
  return raw.slice(0, end).trim().normalize("NFC");
}

function concealGroups(nodes: readonly TokenNode[]): DocRange[] {
  const groups: DocRange[] = [];
  let current: DocRange | null = null;

  for (const node of nodes) {
    const grouped = node.classes.some((name) => GROUP_CLASSES.has(name));
    if (current !== null && (!grouped || node.from !== current.to)) {
      groups.push(current);
      current = null;
    }
    if (!grouped) continue;
    current ??= { from: node.from, to: node.from };
    current.to = node.to;
  }
  if (current !== null) groups.push(current);
  return groups;
}

function groupAround(groups: readonly DocRange[], outer: DocRange): DocRange {
  const found = groups.find(
    (group) => group.from <= outer.from && group.to >= outer.to,
  );
  return found ?? outer;
}
