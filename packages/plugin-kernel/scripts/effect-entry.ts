import { resolve } from "node:path";
import type { Plugin } from "vite";

export type EffectEntry = "renderer" | "worker";

const libDir = resolve(import.meta.dirname, "../src");
const lib = (name: string) => resolve(libDir, name);

const ENTRIES: Record<EffectEntry, Record<string, string>> = {
  renderer: {
    effect: lib("effect.ts"),
    "effect/Effect": lib("effect-runtime.ts"),
  },
  worker: {
    effect: lib("effect-worker.ts"),
    "effect/Effect": lib("effect-worker-runtime.ts"),
  },
};

const VITEST = { "@effect/vitest": lib("effect-vitest.ts") };

const KERNEL_SCOPE = `${libDir}/`;

const NATIVE = new Set(
  [
    "browser-scheduler.ts",
    "effect.ts",
    "effect-layer.ts",
    "effect-log.ts",
    "effect-runtime.ts",
    "effect-runtime-factory.ts",
    "effect-services.ts",
    "effect-vitest.ts",
    "effect-worker.ts",
    "effect-worker-runtime.ts",
  ].map(lib),
);

export function effectEntry(
  entry: EffectEntry,
  options: { vitest?: boolean; scopes?: readonly string[] } = {},
): Plugin {
  const targets: Record<string, string> = {
    ...ENTRIES[entry],
    ...(options.vitest ? VITEST : {}),
  };
  const scopes = [
    KERNEL_SCOPE,
    ...(options.scopes ?? []).map((dir) => `${resolve(dir)}/`),
  ];
  return {
    name: "zotlit-effect-entry",
    enforce: "pre",
    resolveId(id, importer) {
      if (!Object.hasOwn(targets, id) || importer === undefined) return null;
      const path = importer.split("?", 1)[0]!;
      if (!scopes.some((scope) => path.startsWith(scope))) return null;
      if (NATIVE.has(path)) return null;
      return targets[id];
    },
  };
}

export function effectEntryCheck(entry: EffectEntry): Plugin {
  const runtime = ENTRIES[entry]["effect/Effect"]!;
  const foreign =
    entry === "worker"
      ? [lib("effect-runtime.ts"), lib("effect-log.ts")]
      : [lib("effect-worker-runtime.ts")];
  return {
    name: "zotlit-effect-entry-check",
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || !chunk.isEntry) continue;
        if (!chunk.moduleIds.includes(runtime))
          this.error(
            `${chunk.fileName} does not run Effect through ${runtime}; is effectEntry("${entry}") in its config?`,
          );
        const wrong = chunk.moduleIds.find((id) => foreign.includes(id));
        if (wrong)
          this.error(`The ${entry} chunk ${chunk.fileName} includes ${wrong}`);
      }
    },
  };
}
