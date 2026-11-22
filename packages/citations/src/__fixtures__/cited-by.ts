import { Effect, Layer, Queue, Stream } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { TFile } from "obsidian";

import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { layerUnreadViewServices } from "./view-atoms.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import type { CitedBySnapshot } from "#obsidian/citation-index/service.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";

export interface CitedByHost {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly vault: MemoryVault;
  readonly metadataCache: MemoryMetadataCache;
  readonly workspace: MemoryWorkspace;
  readonly started: readonly string[];
  readonly stopped: readonly string[];
  readonly shownInLibrary: readonly string[];
  publish(key: string, snapshot: CitedBySnapshot): boolean;
  follow(path: string | null, key?: string | null): TFile | null;
  rename(path: string, next: string): void;
  remove(path: string): void;
  close(): Promise<void>;
}

export interface CitedByHostOptions {
  readonly getParsedNote?: CitationIndex["Service"]["getParsedNote"];
}

export async function makeCitedByHost(
  options: CitedByHostOptions = {},
): Promise<CitedByHost> {
  const vault = new MemoryVault();
  const metadataCache = new MemoryMetadataCache();
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const started: string[] = [];
  const stopped: string[] = [];
  const shownInLibrary: string[] = [];
  const observers = new Map<string, (snapshot: CitedBySnapshot) => void>();
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost({ vault, metadataCache, workspace }),
      Layer.mock(ShowInLibrary, {
        show: (indexedKey) =>
          Effect.sync(() => {
            shownInLibrary.push(indexedKey);
          }),
      }),
      Layer.mock(CitationIndex, {
        getParsedNote:
          options.getParsedNote ??
          ((file) => Effect.die(new Error(`no parse for ${file.path}`))),
        citedBy: (key) =>
          Stream.callback<CitedBySnapshot>((queue) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                started.push(key);
                observers.set(key, (snapshot) => {
                  Queue.offerUnsafe(queue, snapshot);
                });
              }),
              () =>
                Effect.sync(() => {
                  observers.delete(key);
                  stopped.push(key);
                }),
            ),
          ),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    vault,
    metadataCache,
    workspace,
    started,
    stopped,
    shownInLibrary,
    publish: (key, snapshot) => {
      const observer = observers.get(key);
      observer?.(snapshot);
      return observer !== undefined;
    },
    follow: (path, key = null) => {
      if (path === null) {
        workspace.open(null);
        return null;
      }
      const file = vault.getFileByPath(path) ?? vault.add(path);
      file.extension = path.slice(path.lastIndexOf(".") + 1);
      metadataCache.setCache(path, {
        frontmatter: key === null ? {} : { "zotero-key": key },
      });
      workspace.open(file);
      return file;
    },
    rename: (path, next) => {
      const file = vault.getFileByPath(path);
      if (!file) throw new Error(`no file at ${path}`);
      const cache = metadataCache.getCache(path);
      if (cache) metadataCache.setCache(next, cache);
      vault.rename(file, next);
    },
    remove: (path) => vault.remove(path),
    close: async () => {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
