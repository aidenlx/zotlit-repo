import type { RiskChange } from "#record-risk";
import { regex } from "arkregex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "zx";

import { readFormatVersion } from "#format-versions";

export interface ContractVersion {
  name: string;
  file: string;
  key: string;
  formerPaths?: readonly string[];
}

export interface ContractExemption {
  file: string;
  key: string;
  reason: string;
}

export interface FoundContract {
  file: string;
  key: string;
}

export const CONTRACT_VERSIONS: readonly ContractVersion[] = [
  {
    name: "Citations CLI",
    file: "packages/citations/src/obsidian/citation-index/cli/envelope.ts",
    key: "CONTRACT_VERSION",
  },
  {
    name: "Item Query CLI",
    file: "packages/query-views/src/worker/item-query/contract-version.json",
    key: "contractVersion",
    formerPaths: [
      "packages/query-views/src/desktop/item-query/contract-version.json",
    ],
  },
  {
    name: "Template Workbench CLI",
    file: "packages/template-workbench/src/desktop/cli/envelope.ts",
    key: "CONTRACT_VERSION",
  },
  {
    name: "Library Scope CLI",
    file: "packages/plugin-services/src/obsidian/library-scope/cli.ts",
    key: "CONTRACT_VERSION",
  },
  {
    name: "Annotation image CLI",
    file: "packages/annotations/src/obsidian/excerpt-image/cli-image.ts",
    key: "contractVersion",
  },
  {
    name: "Pandoc integration",
    file: "packages/citations/src/core/pandoc/contract.ts",
    key: "CONTRACT_VERSION",
  },
  {
    name: "Template data contract",
    file: "packages/db/src/contract/roots.ts",
    key: "CONTRACT_VERSION",
  },
  {
    name: "Companion protocol",
    file: "packages/protocol/src/version.ts",
    key: "PROTOCOL_VERSION",
  },
];

const FROM_TEMPLATE_CONTRACT =
  "Names the version of the Template data contract, which is registered in packages/db/src/contract/roots.ts";

export const CONTRACT_EXEMPTIONS: readonly ContractExemption[] = [
  {
    file: "packages/plugin-services/src/core/zotero-local-api/wire.ts",
    key: "API_VERSION",
    reason:
      "The Zotero Web API version that ZotLit asks Zotero for; Zotero owns it",
  },
  {
    file: "packages/query-views/src/worker/item-query/contract.ts",
    key: "CONTRACT_VERSION",
    reason:
      "Reads the Item Query CLI version from contract-version.json, which is registered",
  },
  {
    file: "packages/templates/src/literature-note-template.ts",
    key: "SYNTHESIZED_CONTRACT_VERSION",
    reason: FROM_TEMPLATE_CONTRACT,
  },
  ...["ir.json", "ir.runtime.json"].map((name) => ({
    file: `packages/db/src/contract/generated/${name}`,
    key: "contractVersion",
    reason: `Generated from packages/db/src/contract/roots.ts, which is registered`,
  })),
  ...["book", "conference-paper", "journal-article", "thesis"].map((name) => ({
    file: `packages/notes/src/core/template-preview/samples/${name}.json`,
    key: "contractVersion",
    reason: FROM_TEMPLATE_CONTRACT,
  })),
];

const VERSION_NAME = regex("(?:contract|protocol|api|wire|rpc)_?version$");
const CONSTANT = regex(
  "^(?:export\\s+)?const\\s+(?<key>\\w+)\\s*(?::[^=]+)?=",
  "gm",
);

const looksLikeVersion = (key: string) => VERSION_NAME.test(key.toLowerCase());

export function scanContractVersions(
  sources: readonly { path: string; text: string }[],
): FoundContract[] {
  return sources.flatMap(({ path, text }) => {
    if (path.endsWith(".json")) {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return [];
      }
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return [];
      return Object.entries(value).flatMap(([key, each]) =>
        looksLikeVersion(key) && Number.isSafeInteger(each)
          ? [{ file: path, key }]
          : [],
      );
    }
    const found: FoundContract[] = [];
    CONSTANT.lastIndex = 0;
    for (let m = CONSTANT.exec(text); m; m = CONSTANT.exec(text)) {
      if (looksLikeVersion(m.groups.key))
        found.push({ file: path, key: m.groups.key });
    }
    return found;
  });
}

export function contractListProblems(
  found: readonly FoundContract[],
  registry: readonly ContractVersion[],
  exemptions: readonly ContractExemption[],
): { unlisted: FoundContract[]; stale: FoundContract[] } {
  const id = ({ file, key }: FoundContract) => `${file}\0${key}`;
  const listed = [...registry, ...exemptions].map(({ file, key }) => ({
    file,
    key,
  }));
  const foundIds = new Set(found.map(id));
  const listedIds = new Set(listed.map(id));
  return {
    unlisted: found.filter((each) => !listedIds.has(id(each))),
    stale: listed.filter((each) => !foundIds.has(id(each))),
  };
}

const SOURCE_FILE = regex("\\.(?:ts|tsx|json)$");
const TEST_FILE = regex("\\.test\\.tsx?$|/__snapshots__/|/__mocks__/");

export async function repositoryContractSources(
  root: string,
): Promise<{ path: string; text: string }[]> {
  const paths = (
    await $({
      cwd: root,
      quiet: true,
    })`git ls-files -- ${[":(glob)packages/*/src/**", ":(glob)apps/*/src/**"]}`
  ).stdout
    .split("\n")
    .filter((path) => SOURCE_FILE.test(path) && !TEST_FILE.test(path));
  const sources: { path: string; text: string }[] = [];
  for (const path of paths) {
    try {
      sources.push({ path, text: await readFile(join(root, path), "utf8") });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(
        `${path} cannot be read, so the contract scan is not complete: ${(error as Error).message}`,
      );
    }
  }
  return sources;
}

export function readContractVersion(
  entry: ContractVersion,
  text: string,
  path: string = entry.file,
): number | null {
  if (!path.endsWith(".json")) return readFormatVersion(text, entry.key);
  const value: unknown = (JSON.parse(text) as Record<string, unknown>)[
    entry.key
  ];
  return Number.isSafeInteger(value) ? (value as number) : null;
}

async function baseVersion(
  root: string,
  base: string,
  entry: ContractVersion,
): Promise<number | null> {
  const candidates = [entry.file, ...(entry.formerPaths ?? [])];
  let anyFile = false;
  for (const path of candidates) {
    const shown = await $({
      cwd: root,
      quiet: true,
      nothrow: true,
    })`git show ${`${base}:${path}`}`;
    if (shown.exitCode !== 0) continue;
    anyFile = true;
    const version = readContractVersion(entry, shown.stdout, path);
    if (version !== null) return version;
  }
  if (!anyFile && !entry.formerPaths?.length) return null;
  throw new Error(
    `contract ${entry.name} has no ${entry.key} at the base ${base.slice(0, 12)} in ${candidates.join(", ")}. Correct formerPaths in CONTRACT_VERSIONS (packages/scripts/lib/contract-versions.ts).`,
  );
}

export async function contractChanges(
  root: string,
  base: string,
  registry: readonly ContractVersion[] = CONTRACT_VERSIONS,
): Promise<RiskChange[]> {
  const changes: RiskChange[] = [];
  for (const entry of registry) {
    const text = await readFile(join(root, entry.file), "utf8").catch(
      () => undefined,
    );
    const head = text === undefined ? null : readContractVersion(entry, text);
    if (head === null) {
      throw new Error(
        `${entry.file}: the ${entry.name} version ${entry.key} cannot be read. Keep it a decimal integer literal, or move its entry in CONTRACT_VERSIONS (packages/scripts/lib/contract-versions.ts) with it.`,
      );
    }
    const old = await baseVersion(root, base, entry);
    if (old !== null && old !== head) {
      changes.push({
        subject: `Contract ${entry.name}`,
        old: String(old),
        new: String(head),
      });
    }
  }
  return changes;
}
