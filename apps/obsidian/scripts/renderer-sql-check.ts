import { relative } from "node:path";
import type { Plugin } from "vite";

const SQL_PACKAGE = "/node_modules/drizzle-orm/";

export function rendererSqlCheck(root: string): Plugin {
  return {
    name: "zotlit-renderer-sql-check",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        const target = chunk.moduleIds.find((id) => id.includes(SQL_PACKAGE));
        if (!target) continue;
        const imports = (id: string) => {
          const info = this.getModuleInfo(id);
          return [
            ...(info?.importedIds ?? []),
            ...(info?.dynamicallyImportedIds ?? []),
          ];
        };
        const bundled = new Set(chunk.moduleIds);
        const entry = chunk.facadeModuleId;
        const chain = entry
          ? (importChain([entry, target], (id) =>
              imports(id).filter((next) => bundled.has(next)),
            ) ?? importChain([entry, target], imports))
          : null;
        this.error(
          `${chunk.fileName} bundles drizzle-orm, which only the ZoteroReads Worker runs. Import what the renderer needs from a module that does not reach it:\n  ${(chain ?? [target]).map((id) => relative(root, id)).join("\n  -> ")}`,
        );
      }
    },
  };
}

function importChain(
  [entry, target]: readonly [string, string],
  imports: (id: string) => readonly string[],
): string[] | null {
  const from = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (id === target) {
      const chain: string[] = [];
      for (let at: string | null = id; at; at = from.get(at) ?? null)
        chain.unshift(at);
      return chain;
    }
    for (const next of imports(id)) {
      if (from.has(next)) continue;
      from.set(next, id);
      queue.push(next);
    }
  }
  return null;
}
