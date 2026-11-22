import type { App, MetadataCache } from "obsidian";

import type { GraphCitationAdditions, LinkMap } from "./adapter.ts";

export interface FacadeEngine {
  app: App;
}

export function renderWithFacade(
  engine: FacadeEngine,
  render: () => unknown,
  additions: GraphCitationAdditions,
): unknown {
  const app = engine.app;
  engine.app = facadeApp(app, additions);
  try {
    return render.call(engine);
  } finally {
    engine.app = app;
  }
}

export function facadeApp(app: App, additions: GraphCitationAdditions): App {
  const metadataCache = facadeMetadataCache(app.metadataCache, additions);
  return new Proxy(app, {
    get(target, key, receiver) {
      if (key === "metadataCache") return metadataCache;
      return forward(target, key, receiver);
    },
  });
}

function facadeMetadataCache(
  cache: MetadataCache,
  additions: GraphCitationAdditions,
): MetadataCache {
  let resolvedLinks = mergeLinkMaps(
    withoutLinks(cache.resolvedLinks, additions.hiddenLinks),
    additions.resolvedLinks,
  );
  let unresolvedLinks = mergeLinkMaps(
    cache.unresolvedLinks,
    additions.unresolvedLinks,
  );
  const { survivingPaths, citedWorkNodes } = additions;
  const narrows =
    survivingPaths !== null && typeof cache.getCachedFiles === "function";
  if (narrows) {
    resolvedLinks = onlyLinksTo(resolvedLinks, (target) =>
      survivingPaths.has(target),
    );
    unresolvedLinks = onlyLinksTo(unresolvedLinks, (target) =>
      citedWorkNodes.has(target),
    );
  }
  return new Proxy(cache, {
    get(target, key, receiver) {
      if (key === "resolvedLinks") return resolvedLinks;
      if (key === "unresolvedLinks") return unresolvedLinks;
      if (key === "getCachedFiles" && narrows) {
        return () =>
          target.getCachedFiles!().filter((path) => survivingPaths.has(path));
      }
      if (key === "getCache" && narrows) return () => null;
      return forward(target, key, receiver);
    },
  });
}

export function withoutLinks(base: LinkMap, hidden: LinkMap): LinkMap {
  const sources = Object.keys(hidden);
  if (sources.length === 0) return base;
  const stripped: LinkMap = { ...base };
  for (const source of sources) {
    const links = base[source];
    if (!links) continue;
    const kept: Record<string, number> = {};
    for (const [target, count] of Object.entries(links)) {
      const remaining = count - (hidden[source]![target] ?? 0);
      if (remaining > 0) kept[target] = remaining;
    }
    stripped[source] = kept;
  }
  return stripped;
}

export function onlyLinksTo(
  base: LinkMap,
  kept: (target: string) => boolean,
): LinkMap {
  const stripped: LinkMap = {};
  let dropped = false;
  for (const [source, links] of Object.entries(base)) {
    const entries = Object.entries(links).filter(([target]) => kept(target));
    if (entries.length !== Object.keys(links).length) dropped = true;
    stripped[source] = Object.fromEntries(entries);
  }
  return dropped ? stripped : base;
}

function forward(target: object, key: string | symbol, receiver: unknown) {
  const value = Reflect.get(target, key, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

export function mergeLinkMaps(base: LinkMap, additions: LinkMap): LinkMap {
  const sources = Object.keys(additions);
  if (sources.length === 0) return base;
  const merged: LinkMap = { ...base };
  for (const source of sources) {
    merged[source] = { ...base[source], ...additions[source] };
  }
  return merged;
}
