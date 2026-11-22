import { resolve } from "node:path";
import { normalizePath } from "vite";
import type { Plugin } from "vite";

import { chineseFile, scanChinesePages } from "./content-scan.ts";

export function chinesePagesPlugin(packageRoot: string): Plugin {
  const inventory = () => JSON.stringify(scanChinesePages(packageRoot).sort());
  const contentRoot = `${normalizePath(resolve(packageRoot, "content"))}/`;
  return {
    name: "zotlit:chinese-pages",
    config() {
      return {
        define: {
          __DOCS_CHINESE_PAGES__: inventory(),
        },
      };
    },
    configureServer(server) {
      async function refresh(path: string) {
        if (
          normalizePath(path).startsWith(contentRoot) &&
          chineseFile.test(path)
        ) {
          await server.restart();
          if (server.config.define?.__DOCS_CHINESE_PAGES__ !== inventory()) {
            await server.restart();
          }
        }
      }
      server.watcher
        .on("add", (path) => void refresh(path))
        .on("unlink", (path) => void refresh(path));
    },
  };
}
