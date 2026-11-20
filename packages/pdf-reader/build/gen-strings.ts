import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const PREFIX = "pdf_reader_";
const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const catalog = JSON.parse(
  await readFile(join(workspaceRoot, "messages/en.json"), "utf8"),
) as Record<string, unknown>;

const keys = Object.keys(catalog).filter((key) => key.startsWith(PREFIX));
for (const key of keys) {
  if (typeof catalog[key] !== "string") {
    throw new Error(
      `${key} in messages/en.json has variants; a reader message is plain text with {name} placeholders only`,
    );
  }
}

const union =
  keys.length === 0
    ? "never"
    : keys.map((key) => JSON.stringify(key)).join(" | ");
const record =
  keys.length === 0
    ? "{}"
    : `{\n${keys.map((key) => `  ${key}: ${JSON.stringify(catalog[key])},`).join("\n")}\n}`;
await mkdir(join(packageRoot, "src/generated"), { recursive: true });
await writeFile(
  join(packageRoot, "src/generated/strings.ts"),
  `export type ReaderStringKey = ${union};\n\nexport const englishStrings: Readonly<Record<ReaderStringKey, string>> = ${record};\n`,
);
