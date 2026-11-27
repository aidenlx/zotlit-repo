import { regex } from "arkregex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LAND_RECORD_PATH, LAND_RECORD_ENV, readRecordSection } from "#land";

export interface RiskChange {
  subject: string;
  old: string;
  new: string;
}

export interface RiskVerdict {
  ok: boolean;
  lines: string[];
}

const RISK = "Risk";
const ARROW = regex("\\s*(?:->|→)\\s*", "g");
const SPACE = regex("\\s+", "g");
const THOUSANDS = regex("(?<=\\d),(?=\\d{3}\\b)", "g");
const LIST_MARK = regex("^[-*]\\s*");
const WORD = regex("^\\w");

export function riskLine(change: RiskChange): string {
  return `${change.subject}: ${change.old} → ${change.new}`;
}

function normalize(line: string): string {
  return line
    .trim()
    .replace(LIST_MARK, "")
    .replace(ARROW, " → ")
    .replace(THOUSANDS, "")
    .replace(SPACE, " ");
}

export function riskVerdict({
  changes,
  record,
  required,
  path = LAND_RECORD_PATH,
}: {
  changes: readonly RiskChange[];
  record: string | undefined;
  required: boolean;
  path?: string;
}): RiskVerdict {
  if (changes.length === 0) return { ok: true, lines: [] };
  const wanted = changes.map(riskLine);
  if (record === undefined) {
    return {
      ok: !required,
      lines: [
        required
          ? `The land has no record file at ${path}. Write it with these lines in its "## ${RISK}" section:`
          : `The record file ${path} of the land will need these lines in its "## ${RISK}" section:`,
        ...wanted,
      ],
    };
  }
  const risk = (readRecordSection(record, RISK) ?? "")
    .split("\n")
    .map(normalize);
  const missing = wanted.filter((line) => {
    const target = normalize(line);
    return !risk.some(
      (each) =>
        each.startsWith(target) && !WORD.test(each.slice(target.length)),
    );
  });
  if (missing.length === 0) return { ok: true, lines: [] };
  return {
    ok: false,
    lines: [
      `The record that this check read (${path}) does not name these changes in its "## ${RISK}" section. To fix it, edit ${LAND_RECORD_PATH}: add each line with what it means for users, then land again.`,
      ...missing,
    ],
  };
}

export async function readLandRecord(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ record: string | undefined; required: boolean; path: string }> {
  const copy = env[LAND_RECORD_ENV];
  const path = copy || LAND_RECORD_PATH;
  const record = await readFile(
    copy || join(root, LAND_RECORD_PATH),
    "utf8",
  ).catch(() => undefined);
  return { record, required: Boolean(copy), path };
}
