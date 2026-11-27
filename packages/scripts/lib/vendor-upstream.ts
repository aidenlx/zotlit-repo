import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface VendoredExtract {
  readonly source: string;
  readonly build: (tree: string) => Promise<string>;
}

export interface VendoredSource {
  readonly repository: string;
  readonly dest: string;
  readonly paths: readonly string[];
  readonly extracts?: Readonly<Record<string, VendoredExtract>>;
  readonly next: string;
}

export async function installVendoredTree({
  source,
  tree,
  dest,
  commit,
}: {
  readonly source: VendoredSource;
  readonly tree: string;
  readonly dest: string;
  readonly commit: string;
}): Promise<void> {
  const extracts = await Promise.all(
    Object.entries(source.extracts ?? {}).map(
      async ([file, { build }]) => [file, await build(tree)] as const,
    ),
  );
  for (const path of source.paths) {
    await rm(join(dest, path), { recursive: true, force: true });
    await cp(join(tree, path), join(dest, path), { recursive: true });
  }
  for (const [file, content] of extracts) {
    await writeFile(join(dest, file), content);
  }
  await writeFile(
    join(dest, "provenance.json"),
    `${JSON.stringify(
      {
        repository: `https://github.com/${source.repository}`,
        commit,
        paths: source.paths,
        ...(source.extracts && {
          extracts: Object.fromEntries(
            Object.entries(source.extracts).map(([file, extract]) => [
              file,
              extract.source,
            ]),
          ),
        }),
      },
      null,
      2,
    )}\n`,
  );
}

export function readPropertiesValue(
  properties: string,
  key: string,
  file: string,
): string {
  const values = logicalLineStarts(properties)
    .filter((line) => line.startsWith(key))
    .map((line) => line.slice(key.length).trimStart())
    .filter((rest) => rest.startsWith("=") || rest.startsWith(":"))
    .map((rest) => rest.slice(1).trimStart());
  if (values.length === 0) throw new Error(`${file} has no ${key} entry`);
  if (values.length > 1) {
    throw new Error(`${file} has more than one ${key} entry`);
  }
  const value = values[0]!;
  if (value.includes("\\")) {
    throw new Error(
      `${file}: the ${key} entry has a backslash (an escape or a continued line), which the extract does not read`,
    );
  }
  return value;
}

function logicalLineStarts(properties: string): string[] {
  const starts: string[] = [];
  let continued = false;
  for (const raw of properties.split(/\r?\n/)) {
    const line = raw.trimStart();
    const comment: boolean =
      !continued && (line.startsWith("#") || line.startsWith("!"));
    if (!continued) starts.push(line);
    const backslashes = line.length - line.replace(/\\+$/, "").length;
    continued = !comment && backslashes % 2 === 1;
  }
  return starts;
}

export async function daySuffixes(tree: string): Promise<string> {
  const localeRoot = join(tree, "chrome/locale");
  const suffixes: Record<string, string> = {};
  for (const locale of (await readdir(localeRoot)).toSorted()) {
    const file = `chrome/locale/${locale}/zotero/zotero.properties`;
    suffixes[locale] = readPropertiesValue(
      await readFile(join(tree, file), "utf8"),
      "date.daySuffixes",
      file,
    );
  }
  return `${JSON.stringify(suffixes, null, 2)}\n`;
}
