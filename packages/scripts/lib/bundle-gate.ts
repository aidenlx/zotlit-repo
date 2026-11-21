import type { PublishedPlugin } from "#shell/plugins";
import { regex } from "arkregex";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

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

/**
 * Checks the production build of `plugin` in `appDir`, its host app's folder:
 * the sizes of its built files, the modules its `main.js` requires, and the
 * checks its profile adds.
 */
export async function checkBundle(
  name: string,
  plugin: Pick<PublishedPlugin, "profile" | "budget" | "allowedRequires">,
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
  const unexpected = requiredModules(mainJs).filter(
    (id) => !plugin.allowedRequires.includes(id),
  );
  return {
    name,
    lines: [...sizes.map(({ line }) => line), ...pack.lines],
    failures: [
      ...sizes.flatMap(({ failure }) => (failure ? [failure] : [])),
      ...unexpected.map(
        (id) => `main.js requires "${id}", which is not in its allowedRequires`,
      ),
      ...pack.failures,
    ],
  };
}
