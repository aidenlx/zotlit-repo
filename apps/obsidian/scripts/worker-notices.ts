import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ParseResult } from "vite";

export interface LicenceFallback {
  readonly package: string;
  readonly version: string;
  readonly file: string;
  readonly source: string;
}

const LICENCE_FILE =
  /^(?:license|licence|copying)(?:-[\w-]+)?(?:\.(?:md|txt))?$/i;
const isNoticeFile = (name: string) => name.toLowerCase().startsWith("notice");

function packageDirOf(moduleId: string): string | undefined {
  const path = moduleId.split("?", 1)[0]!.replaceAll("\\", "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const rest = path.slice(at + "/node_modules/".length).split("/");
  const depth = rest[0]?.startsWith("@") ? 2 : 1;
  return `${path.slice(0, at)}/node_modules/${rest.slice(0, depth).join("/")}`;
}

async function licenceTexts(
  dir: string,
  { name, version }: { readonly name: string; readonly version: string },
  manifest: string,
): Promise<string[] | string> {
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .toSorted();
  const read = (paths: readonly string[]) =>
    Promise.all(paths.map((path) => readFile(path, "utf8")));
  const notices = await read(
    files.filter(isNoticeFile).map((file) => join(dir, file)),
  );
  const licences = files.filter((file) => LICENCE_FILE.test(file));
  if (licences.length > 0)
    return [
      ...(await read(licences.map((file) => join(dir, file)))),
      ...notices,
    ];
  const fallbacks = (
    JSON.parse(await readFile(manifest, "utf8")) as LicenceFallback[]
  ).filter((entry) => entry.package === name);
  const fallback = fallbacks.find((entry) => entry.version === version);
  if (fallback)
    return [
      ...(await read([join(dirname(manifest), fallback.file)])),
      ...notices,
    ];
  if (fallbacks.length === 0)
    return `worker.js bundles ${name} ${version}, which ships no licence file; add one to ${manifest}`;
  return `worker.js bundles ${name} ${version}, and the licence manifest holds the licence verified for ${fallbacks.map((entry) => entry.version).join(", ")}: verify the licence of ${version} and update ${manifest}`;
}

export const isLegalComment = ({ value }: { value: string }) =>
  value.startsWith("!") || /@license|@preserve/.test(value);

export async function bundledNotice(
  moduleIds: readonly string[],
  comments: ParseResult["comments"],
  manifest: string,
): Promise<{ notice: string; failures: string[] }> {
  const dirs = new Set(moduleIds.flatMap((id) => packageDirOf(id) ?? []));
  const failures: string[] = [];
  const parts: string[] = [];
  for (const dir of [...dirs].toSorted()) {
    const { name, version, license } = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    ) as { name: string; version: string; license?: string };
    const texts = await licenceTexts(dir, { name, version }, manifest);
    if (typeof texts === "string") failures.push(texts);
    else
      parts.push(
        [`${name} ${version} (${license ?? "see below"})`, ...texts]
          .map((text) => text.trim())
          .join("\n\n"),
      );
  }
  const legal = [
    ...new Set(
      comments.filter(isLegalComment).map(({ value }) => value.trim()),
    ),
  ];
  const notice = [
    "This file bundles these packages under their own licences:",
    ...parts,
    ...(legal.length > 0
      ? ["The bundled code carries these notices:", ...legal]
      : []),
  ]
    .join("\n\n")
    .replaceAll("*/", "*\\/");
  return { notice: `/*\n${notice}\n*/\n`, failures };
}
