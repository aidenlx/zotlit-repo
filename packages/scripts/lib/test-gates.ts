import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const vitestRequire = createRequire(require.resolve("vitest/package.json"));
const globRequire = createRequire(vitestRequire.resolve("tinyglobby"));
const picomatch = globRequire("picomatch") as (
  patterns: string[],
  options: { dot: boolean },
) => (path: string) => boolean;

export interface Collection {
  root: string;
  include: string[];
  exclude: string[];
  filters?: string[];
}

export interface CollectionConfig {
  root?: string;
  extends?: boolean | string;
  test?: {
    dir?: string;
    name?: string;
    environment?: string;
    include?: string[];
    exclude?: string[];
    projects?: (string | CollectionConfig)[];
  };
}

export function matchesCollection(
  file: string,
  collection: Collection,
): boolean {
  const path = relative(collection.root, resolve(file)).split(sep).join("/");
  if (path === ".." || path.startsWith("../") || isAbsolute(path)) return false;
  if (
    !picomatch(collection.include, { dot: true })(path) ||
    (collection.exclude.length &&
      picomatch(collection.exclude, { dot: true })(path))
  )
    return false;
  return (
    !collection.filters?.length ||
    collection.filters.some((filter) =>
      isAbsolute(filter)
        ? resolve(file).startsWith(filter)
        : path.toLowerCase().includes(filter.toLowerCase()),
    )
  );
}

export function projectCollection(
  config: CollectionConfig,
  cwd: string,
  defaults: { include: string[]; exclude: string[] },
): Collection {
  const root = resolve(cwd, config.root ?? ".");
  return {
    root: resolve(root, config.test?.dir ?? "."),
    include: config.test?.include ?? defaults.include,
    exclude: config.test?.exclude ?? defaults.exclude,
  };
}

export function matchesNodeTest(
  file: string,
  cwd: string,
  patterns: string[],
): boolean {
  return matchesCollection(file, {
    root: cwd,
    include: patterns.length ? patterns : ["**/*.test.{js,cjs,mjs,ts,cts,mts}"],
    exclude: ["**/node_modules/**", "**/.git/**"],
  });
}
