import type { Plugin } from "vite";

const INTERNAL_HTTP = /@effect\/platform-node\/dist\/internal\/http\.js$/;

export function nodeHttpModules(): Plugin {
  let replaced = false;
  return {
    name: "zotlit:node-http-modules",
    enforce: "pre",
    load(id) {
      if (!INTERNAL_HTTP.test(id)) return null;
      replaced = true;
      return `export * as http from "node:http";\nexport * as https from "node:https";\n`;
    },
    buildEnd(error) {
      if (!error && !replaced)
        throw new Error(
          "@effect/platform-node no longer loads node:http from dist/internal/http.js",
        );
    },
  };
}
