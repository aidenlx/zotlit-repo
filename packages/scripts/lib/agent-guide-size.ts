import { regex } from "arkregex";

export interface GuideCount {
  lines: number;
  words: number;
}

export const GUIDE_LIMITS = {
  root: { lines: 200, words: 2400 },
  package: { lines: 100, words: 1200 },
} as const satisfies Record<string, GuideCount>;

export const GUIDE_BASELINE: Readonly<Record<string, GuideCount>> = {
  "apps/docs/AGENTS.md": { lines: 92, words: 2824 },
  "apps/obsidian/AGENTS.md": { lines: 51, words: 1336 },
  "packages/db/AGENTS.md": { lines: 82, words: 2336 },
  "packages/item-query/AGENTS.md": { lines: 57, words: 2331 },
  "packages/plugin-shell/AGENTS.md": { lines: 50, words: 1206 },
  "packages/zotero-compat/AGENTS.md": { lines: 65, words: 1613 },
};

const BLOCK_START = regex(
  "^<!--\\s*(?:BEGIN:(?<upper>[\\w-]+)|(?<lower>[\\w-]+):start)\\s*-->$",
);
const WHITESPACE = regex("\\s+");
const BLOCK_END = regex(
  "^<!--\\s*(?:END:(?<upper>[\\w-]+)|(?<lower>[\\w-]+):end)\\s*-->$",
);

export function countGuide(text: string): GuideCount {
  let open:
    | { line: number; marker: string; upper?: string; lower?: string }
    | undefined;
  let lines = 0;
  let words = 0;
  const all = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  for (const [index, line] of all.entries()) {
    const trimmed = line.trim();
    const start = open ? undefined : BLOCK_START.exec(trimmed);
    if (start) {
      const { upper, lower } = start.groups;
      open = { line: index + 1, marker: trimmed, upper, lower };
      continue;
    }
    if (open) {
      const end = BLOCK_END.exec(trimmed)?.groups;
      if (end && end.upper === open.upper && end.lower === open.lower)
        open = undefined;
      continue;
    }
    lines += 1;
    words += trimmed.split(WHITESPACE).filter(Boolean).length;
  }
  if (open) {
    throw new Error(
      `line ${open.line}: ${open.marker} has no end marker, so the generated block does not close.`,
    );
  }
  return { lines, words };
}

export function guideLimit(path: string): GuideCount {
  return path === "AGENTS.md" ? GUIDE_LIMITS.root : GUIDE_LIMITS.package;
}

export type GuideCheck =
  | { ok: true; note?: string }
  | { ok: false; message: string };

const number = (value: number) => value.toLocaleString("en-US");
const MEASURES = ["words", "lines"] as const;

export function checkGuide(
  path: string,
  text: string,
  baseline: GuideCount | undefined,
): GuideCheck {
  let count: GuideCount;
  try {
    count = countGuide(text);
  } catch (error) {
    return { ok: false, message: `${path}: ${(error as Error).message}` };
  }
  const limit = guideLimit(path);
  const kind = path === "AGENTS.md" ? "the root guide" : "a package guide";
  const problems = MEASURES.flatMap((measure) => {
    const allowed = Math.max(limit[measure], baseline?.[measure] ?? 0);
    if (count[measure] <= allowed) return [];
    return [
      baseline && baseline[measure] > limit[measure]
        ? `${number(count[measure])} ${measure}, above its baseline of ${number(baseline[measure])} in GUIDE_BASELINE (the limit for ${kind} is ${number(limit[measure])} ${measure})`
        : `${number(count[measure])} ${measure}, above the limit of ${number(limit[measure])} ${measure} for ${kind}`,
    ];
  });
  if (problems.length > 0) {
    return {
      ok: false,
      message: `${path}: ${problems.join("; ")}. Generated blocks do not count. Trim the guide as the agents-md skill describes: keep commands, navigation and constraints, and move the rest to the source or a pointed-to doc.`,
    };
  }
  if (!baseline) return { ok: true };
  if (MEASURES.every((measure) => count[measure] <= limit[measure])) {
    return {
      ok: true,
      note: `${path} is now under the limit for ${kind}: remove it from GUIDE_BASELINE in packages/scripts/lib/agent-guide-size.ts.`,
    };
  }
  if (
    MEASURES.some(
      (measure) =>
        baseline[measure] > limit[measure] &&
        count[measure] < baseline[measure],
    )
  ) {
    return {
      ok: true,
      note: `${path} is under its baseline: lower its baseline to { lines: ${count.lines}, words: ${count.words} } in GUIDE_BASELINE (packages/scripts/lib/agent-guide-size.ts), so a later change cannot undo the trim.`,
    };
  }
  return { ok: true };
}
