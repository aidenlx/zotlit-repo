import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

import { paraglideVitePlugin } from "@zotlit/paraglide-vite";

import { paraglideOptions } from "./paraglide.config.ts";
import { agentSkillAssets } from "./src/lib/agent-skills.ts";
import { chinesePagesPlugin } from "./src/lib/chinese-pages-plugin.ts";
import { firstCommitsPlugin } from "./src/lib/first-commits.ts";
import { buildHeaderRules, renderHeadersFile } from "./src/lib/headers.ts";
import { learnMediaPlugin } from "./src/lib/learn-media.ts";
import type { StoredVideo } from "./src/lib/media-store.ts";
import { mediaStorePlugin, scanVideos } from "./src/lib/media-store.ts";
import { createOgCardRenderer } from "./src/lib/og-card.tsx";
import { ogCards } from "./src/lib/og-cards.ts";
import { prerenderPages } from "./src/lib/prerender-pages.ts";
import { renderSiteRedirectsFile } from "./src/lib/redirects.ts";
import type { DocsLine } from "./src/lib/shared.ts";

const packageRoot = import.meta.dirname;
let recordings: StoredVideo[] | undefined;
const videos = () => (recordings ??= scanVideos(packageRoot));
process.env.MINIFLARE_REGISTRY_PATH ??= resolve(
  packageRoot,
  ".wrangler/registry",
);
const fumadocsServer = fileURLToPath(
  import.meta.resolve("fumadocs-core/server"),
);

function fumadocsServerOnWorker(): Plugin {
  return {
    name: "zotlit:fumadocs-server-on-worker",
    enforce: "pre",
    resolveId(source) {
      if (
        source !== "fumadocs-core/server" ||
        this.environment.name !== "ssr"
      ) {
        return undefined;
      }
      return fumadocsServer;
    },
  };
}

let docsLine: DocsLine | undefined;

function resolvedDocsLine(): DocsLine {
  if (docsLine === undefined) {
    throw new Error("Cloudflare configuration did not provide DOCS_LINE.");
  }
  return docsLine;
}

function cloudflareAssetRules(): Plugin {
  return {
    name: "zotlit:cloudflare-asset-rules",
    apply: "build",
    generateBundle() {
      if (this.environment.name !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "_redirects",
        source: renderSiteRedirectsFile(),
      });
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: renderHeadersFile(
          buildHeaderRules(
            prerenderPages(packageRoot).map(({ path }) => path),
            { docsLine: resolvedDocsLine() },
          ),
        ),
      });
    },
  };
}

function machineAssets(): Plugin {
  const renderCard = createOgCardRenderer(packageRoot);
  let skills: Promise<Map<string, Uint8Array>> | undefined;
  const agentSkills = () =>
    (skills ??= agentSkillAssets(packageRoot, resolvedDocsLine()));

  return {
    name: "zotlit:machine-assets",
    async generateBundle() {
      if (this.environment.name !== "client") return;

      const assets = new Map(await agentSkills());
      for (const [path, card] of await ogCards(packageRoot)) {
        assets.set(path, await renderCard(card));
      }
      for (const [path, source] of assets) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source });
      }
    },
    configureServer(server) {
      async function resolveAsset(path: string) {
        const skill = (await agentSkills()).get(path);
        if (skill) {
          const type = path.endsWith(".json")
            ? "application/json"
            : "application/zip";
          return { type, body: skill };
        }

        const card = (await ogCards(packageRoot)).get(path);
        if (!card) return undefined;
        return { type: "image/webp", body: await renderCard(card) };
      }

      server.middlewares.use((req, res, next) => {
        void (async () => {
          const path = req.url?.split("?")[0];
          if (!path) {
            next();
            return;
          }

          try {
            const asset = await resolveAsset(path);
            if (!asset) {
              next();
              return;
            }
            res.setHeader("content-type", asset.type);
            res.end(Buffer.from(asset.body));
          } catch (error) {
            next(error);
          }
        })();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  optimizeDeps: {
    include: ["@base-ui/react > use-sync-external-store/shim/with-selector"],
  },
  environments: {
    ssr: {
      optimizeDeps: {
        include: [
          "fumadocs-mdx/runtime/macro",
          "fumadocs-ui/components/card",
          "fumadocs-ui/components/steps",
        ],
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(packageRoot, "src"),
    },
  },
  plugins: [
    chinesePagesPlugin(packageRoot),
    firstCommitsPlugin(packageRoot),
    learnMediaPlugin(packageRoot, videos),
    mediaStorePlugin(packageRoot, videos),
    fumadocsServerOnWorker(),
    paraglideVitePlugin({
      ...paraglideOptions,
      outputStructure:
        command === "serve" ? "locale-modules" : "message-modules",
    }),
    devtools(),
    tailwindcss(),
    fumadocsMdx({ index: false }),
    cloudflareAssetRules(),
    machineAssets(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config(config) {
        const value = config.vars?.DOCS_LINE;
        if (value !== "production" && value !== "beta") {
          throw new Error("DOCS_LINE must be 'production' or 'beta'.");
        }
        docsLine = value;
      },
    }),
    tanstackStart({
      pages: prerenderPages(packageRoot),
      prerender: {
        enabled: true,
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
      },
    }),
    viteReact(),
  ],
}));
