import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const packageRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const provenance = JSON.parse(
  await readFile(join(workspaceRoot, "packages/pdfjs/provenance.json"), "utf8"),
) as { readonly commit?: unknown };
if (typeof provenance.commit !== "string" || provenance.commit === "") {
  throw new Error("packages/pdfjs/provenance.json names no fork commit");
}
await mkdir(join(packageRoot, "src/generated"), { recursive: true });
await writeFile(
  join(packageRoot, "src/generated/pdfjs-build.ts"),
  `export const pdfjsBuild = ${JSON.stringify(provenance.commit)};\n`,
);
