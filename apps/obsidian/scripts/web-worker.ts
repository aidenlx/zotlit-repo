import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

import { effectEntry, effectEntryCheck } from "@zotlit/plugin-kernel/vite";
import { RUNTIMES } from "@zotlit/scripts/runtime-table";
import { TEMPORAL_PIECE_URL_GLOBAL } from "@zotlit/zotero-reads/contract/web-worker.ts";

import type { EmbeddedWorkerOptions } from "./embedded-worker.ts";

const sourceDir = (module: string) =>
  fileURLToPath(new URL(".", import.meta.resolve(module)));

const WEB_ROOT = fileURLToPath(
  new URL("../src/worker/zotero-reads-web-root.ts", import.meta.url),
);
const WEB_SOURCES = [
  fileURLToPath(new URL("../src/worker/", import.meta.url)),
  sourceDir("@zotlit/query-views/worker/item-query/job.ts"),
  sourceDir("@zotlit/zotero-reads/worker/serve-web.ts"),
];
const TEMPORAL_PIECE = fileURLToPath(
  import.meta.resolve("@zotlit/plugin-kernel/worker/temporal-piece.ts"),
);

const MOBILE_FLOOR = ["chrome108", "safari16.4"];

const NOTICES = {
  fallbacks: fileURLToPath(
    new URL("../../../licences/manifest.json", import.meta.url),
  ),
};

const WASM_GLUE = [
  /[\\/]@sqlite\.org[\\/]sqlite-wasm[\\/]dist[\\/]/,
  /[\\/]jieba-wasm[\\/]pkg[\\/]web[\\/]/,
];

function wasmGlueUrls(): Plugin {
  return {
    name: "wasm-glue-urls",
    enforce: "pre",
    transform(code, id) {
      if (!WASM_GLUE.some((glue) => glue.test(id))) return null;
      return {
        code: code.replaceAll("import.meta.url", "globalThis.location.href"),
        map: null,
      };
    },
  };
}

export function webWorkerRoots(mode: string): readonly EmbeddedWorkerOptions[] {
  const isProd = mode === "production";
  const config = {
    mode,
    define: { "process.env.NODE_ENV": JSON.stringify(mode) },
    minify: isProd,
    sourcemap: isProd ? false : ("inline" as const),
    target: MOBILE_FLOOR,
  };
  return [
    {
      id: "virtual:zotero-reads-web-worker",
      entry: WEB_ROOT,
      runtime: RUNTIMES.webWorker,
      form: "deflated",
      notices: NOTICES,
      scriptUrlGlobal: TEMPORAL_PIECE_URL_GLOBAL,
      config: {
        ...config,
        plugins: [
          wasmGlueUrls(),
          effectEntry("worker", { scopes: WEB_SOURCES }),
          effectEntryCheck("worker"),
        ],
      },
    },
    {
      id: "virtual:temporal-piece",
      entry: TEMPORAL_PIECE,
      runtime: RUNTIMES.webWorker,
      form: "deflated",
      notices: NOTICES,
      config,
    },
  ];
}
