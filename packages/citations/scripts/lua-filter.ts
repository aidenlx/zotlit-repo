import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

export type PandocFilterVariant = "cli" | "sandbox";

const VARIANTS: readonly PandocFilterVariant[] = ["cli", "sandbox"];

const OPEN = "--@variant ";
const CLOSE = "--@end";

export function buildFilterVariant(
  source: string,
  variant: PandocFilterVariant,
): string {
  const kept: string[] = [];
  let open: string | undefined;
  let matched = false;

  for (const [index, line] of source.split("\n").entries()) {
    const at = `line ${index + 1}`;
    if (line.startsWith(OPEN)) {
      const name = line.slice(OPEN.length);
      if (open) throw new Error(`Nested --@variant region at ${at}`);
      if (!VARIANTS.includes(name as PandocFilterVariant)) {
        throw new Error(`Unknown filter variant "${name}" at ${at}`);
      }
      open = name;
      matched ||= name === variant;
      continue;
    }
    if (line === CLOSE) {
      if (!open) throw new Error(`--@end without a --@variant region at ${at}`);
      open = undefined;
      continue;
    }
    if (!open || open === variant) kept.push(line);
  }

  if (open) throw new Error(`Unclosed --@variant ${open} region`);
  if (!matched)
    throw new Error(`The source has no --@variant ${variant} region`);
  return kept.join("\n");
}

const SUFFIX = "?variant=";

function parseVariantId(
  id: string,
): { path: string; variant: PandocFilterVariant } | null {
  const at = id.indexOf(SUFFIX);
  if (at === -1) return null;
  const path = id.slice(0, at);
  if (!path.endsWith(".lua")) return null;
  return { path, variant: id.slice(at + SUFFIX.length) as PandocFilterVariant };
}

export function pandocFilterVariants(): Plugin {
  return {
    name: "pandoc-filter-variants",
    async resolveId(id, importer) {
      const parsed = parseVariantId(id);
      if (!parsed) return null;
      const resolved = await this.resolve(parsed.path, importer, {
        skipSelf: true,
      });
      return resolved && `${resolved.id}${SUFFIX}${parsed.variant}`;
    },
    async load(id) {
      const parsed = parseVariantId(id);
      if (!parsed) return null;
      const { path, variant } = parsed;
      if (!VARIANTS.includes(variant)) {
        throw new Error(`Unknown filter variant "${variant}" for ${path}`);
      }
      this.addWatchFile(path);
      const source = buildFilterVariant(await readFile(path, "utf8"), variant);
      return `export default ${JSON.stringify(source)};`;
    },
  };
}
