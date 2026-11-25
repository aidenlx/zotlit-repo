import type { Runtime } from "#runtime-table";
import type { PublishedPlugin } from "#shell/plugins";
import { regex } from "arkregex";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const REQUIRE_CALL = regex(
  "\\brequire\\(\\s*([\"'`])(?<id>[^\"'`]+)\\1\\s*\\)",
  "g",
);

export interface BundleReport {
  readonly name: string;
  readonly lines: readonly string[];
  readonly failures: readonly string[];
}

function requiredModules(mainJs: string): string[] {
  const ids = new Set<string>();
  for (let m = REQUIRE_CALL.exec(mainJs); m; m = REQUIRE_CALL.exec(mainJs)) {
    ids.add(m.groups.id);
  }
  return [...ids].toSorted();
}

export function checkRequires(
  file: string,
  code: string,
  runtime: Runtime,
): { required: string[]; failures: string[] } {
  const required = requiredModules(code);
  return {
    required,
    failures: required
      .filter((id) => !runtime.modules.includes(id))
      .map(
        (id) =>
          `${file} requires "${id}", which ${runtime.title} does not give`,
      ),
  };
}

export async function checkBundleRuntime(
  name: string,
  path: string,
  runtime: Runtime,
): Promise<BundleReport> {
  const file = basename(path);
  const code = await readFile(path, "utf8");
  const { required, failures } = checkRequires(file, code, runtime);
  return {
    name,
    lines: [
      `${file} ${Buffer.byteLength(code).toLocaleString("en-US")} B`,
      `requires ${required.join(", ") || "nothing"}`,
    ],
    failures,
  };
}

function sizeLine(
  file: string,
  bytes: number,
  budget: number,
): { line: string; failure?: string } {
  const delta = bytes - budget;
  const line = `${file} ${bytes.toLocaleString("en-US")} B, budget ${budget.toLocaleString("en-US")} B`;
  return delta > 0
    ? {
        line,
        failure: `${file} is ${bytes.toLocaleString("en-US")} B, above its budget of ${budget.toLocaleString("en-US")} B by ${delta.toLocaleString("en-US")} B`,
      }
    : { line };
}

export async function checkBundle(
  name: string,
  plugin: Pick<PublishedPlugin, "profile" | "budget" | "runtime">,
  appDir: string,
): Promise<BundleReport> {
  const { profile } = plugin;
  const distDir = join(appDir, "dist");
  const mainJs = await readFile(join(distDir, "main.js"), "utf8");
  const stylesBytes = profile.builtFiles.includes("styles.css")
    ? (await stat(join(distDir, "styles.css"))).size
    : 0;
  const pack = await profile.checkMain(
    mainJs,
    JSON.parse(await readFile(join(appDir, "package.json"), "utf8")),
  );
  const sizes = [
    sizeLine("main.js", Buffer.byteLength(mainJs), plugin.budget.mainJsBytes),
    sizeLine("styles.css", stylesBytes, plugin.budget.stylesCssBytes),
  ];
  const requires = checkRequires("main.js", mainJs, plugin.runtime);
  return {
    name,
    lines: [...sizes.map(({ line }) => line), ...pack.lines],
    failures: [
      ...sizes.flatMap(({ failure }) => (failure ? [failure] : [])),
      ...requires.failures,
      ...pack.failures,
    ],
  };
}
