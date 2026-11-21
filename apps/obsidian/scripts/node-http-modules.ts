// Build-time replacement of the `@effect/platform-node` module that loads
// `node:http` and `node:https`.

import type { Plugin } from "vite";

/** `@effect/platform-node/dist/internal/http.js`, as Vite resolves it. */
const INTERNAL_HTTP = /@effect\/platform-node\/dist\/internal\/http\.js$/;

/**
 * `@effect/platform-node` requires `node:http` and `node:https` while its
 * module evaluates, so both load at every start, and `node:https` brings
 * `node:tls` and `node:crypto` with it. The replacement imports the two
 * modules: the publish build then makes each load at its first use
 * (`lazyBuiltins` in the shell's `scripts/build.mjs`).
 *
 * @throws at the end of a build that did not replace the module.
 */
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
