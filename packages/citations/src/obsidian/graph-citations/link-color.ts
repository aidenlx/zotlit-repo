import { around } from "monkey-around";
import type { GraphColor, GraphLink, GraphLinkSprite } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import { themeProperty } from "@zotlit/plugin-kernel/theme-hooks.ts";

import type { GraphCitationAdditions } from "./adapter.ts";
import { membersPresent } from "./install.ts";
import type { GraphLeafMembers } from "./install.ts";
import { readThemeColor } from "./node-color.ts";
import type { ThemeColorRole } from "./node-color.ts";

const ROLE: ThemeColorRole = {
  property: themeProperty.graphCitationLink,
  fallback: "--color-purple",
};

export class GraphLinkColor {
  #current: GraphColor | null | undefined;

  current(): GraphColor | null {
    if (this.#current === undefined) this.#current = readThemeColor(ROLE);
    return this.#current;
  }

  invalidate(): void {
    this.#current = undefined;
  }
}

export interface LinkColorsOptions {
  color: GraphLinkColor;
  enabled: () => boolean;
}

export function installLinkColors(
  members: GraphLeafMembers,
  installation: { readonly additions: GraphCitationAdditions },
  options: LinkColorsOptions,
): Disposable {
  const { renderer, viewType } = members;
  const present = membersPresent(
    "Graph renderer is missing an edge member; citation edges left native",
    {
      "renderer.links": Array.isArray(renderer.links),
      "renderer.getHighlightNode":
        typeof renderer.getHighlightNode === "function",
      "renderer.changed": typeof renderer.changed === "function",
    },
    { viewType },
  );
  if (!present) return disposable(() => {});

  const tint = (): number | null =>
    options.enabled() ? (options.color.current()?.rgb ?? null) : null;

  const tintOf = (link: GraphLink): number | null => {
    const substitute = tint();
    if (substitute === null) return null;
    const highlight = renderer.getHighlightNode!();
    if (highlight === link.source || highlight === link.target) return null;
    return substitute;
  };
  const isCitation = (
    link: GraphLink,
    rendered: ReadonlySet<string>,
  ): boolean => {
    const { citationLinks } = installation.additions;
    const source = link.source.id;
    const target = link.target.id;
    if (citationLinks[source]?.[target] !== undefined) return true;
    return (
      citationLinks[target]?.[source] !== undefined &&
      rendered.has(directionOf(target, source))
    );
  };

  let tints = new DisposableStack();
  let drawn: number | null = null;
  let citations = new Set<string>();
  const renew = (): boolean => {
    tints.dispose();
    tints = new DisposableStack();
    const links = renderer.links!;
    const rendered = new Set(
      links.map((link) => directionOf(link.source.id, link.target.id)),
    );
    const next = new Set<string>();
    for (const link of links) {
      if (!isCitation(link, rendered)) continue;
      next.add(directionOf(link.source.id, link.target.id));
      tints.use(installTint(link, tintOf));
    }
    const reclassified =
      next.size !== citations.size ||
      ![...next].every((direction) => citations.has(direction));
    citations = next;
    return reclassified;
  };
  const restores = new DisposableStack();
  restores.defer(
    around(renderer, {
      setData: (setData) => (data) => {
        const handedOff = setData.call(renderer, data);
        const reclassified = renew();
        const next = tint();
        if (next !== drawn || reclassified) {
          drawn = next;
          renderer.changed!();
        }
        return handedOff;
      },
    }),
  );
  restores.defer(() => {
    tints.dispose();
    renderer.changed!();
  });
  return restores;
}

function directionOf(source: string, target: string): string {
  return `${source}\n${target}`;
}

function installTint(
  link: GraphLink,
  tintOf: (link: GraphLink) => number | null,
): Disposable {
  let held = Object.hasOwn(link, "line");
  let sprite = link.line ?? null;
  let substituted = sprite && substituteTint(sprite, () => tintOf(link));
  Object.defineProperty(link, "line", {
    configurable: true,
    enumerable: true,
    get: () => sprite,
    set: (next: GraphLinkSprite | null) => {
      held = true;
      substituted?.[Symbol.dispose]();
      sprite = next ?? null;
      substituted = sprite && substituteTint(sprite, () => tintOf(link));
    },
  });
  return disposable(() => {
    substituted?.[Symbol.dispose]();
    delete link.line;
    if (held) link.line = sprite;
  });
}

function substituteTint(
  sprite: GraphLinkSprite,
  tint: () => number | null,
): Disposable {
  const declared = Object.getPrototypeOf(sprite) as object;
  Object.defineProperty(sprite, "tint", {
    configurable: true,
    enumerable: false,
    get: () => Reflect.get(declared, "tint", sprite) as number,
    set: (next: number) => {
      Reflect.set(declared, "tint", tint() ?? next, sprite);
    },
  });
  return disposable(() => {
    delete (sprite as Partial<GraphLinkSprite>).tint;
  });
}
