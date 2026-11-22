import { regex } from "arkregex";
import { Effect } from "effect";
import { around } from "monkey-around";
import type { GraphColor, GraphData } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { themeProperty } from "@zotlit/plugin-kernel/theme-hooks.ts";

import type { GraphCitationAdditions } from "./adapter.ts";
import type { GraphLeafMembers } from "./install.ts";

export interface ThemeColorRole {
  property: string;
  fallback: string;
}

const ROLE = {
  citedWorkNode: {
    property: themeProperty.graphCitedWorkNode,
    fallback: "--text-faint",
  },
} as const satisfies Record<string, ThemeColorRole>;

export interface NodeColors {
  citedWorkNode: GraphColor | null;
}

export class GraphNodeColors {
  #current: NodeColors | null = null;

  current(): NodeColors {
    return (this.#current ??= readNodeColors());
  }

  literatureNoteGroupColor(): GraphColor {
    return readLiteratureNoteGroupColor();
  }

  invalidate(): void {
    this.#current = null;
  }
}

export function readNodeColors(): NodeColors {
  return {
    citedWorkNode: readThemeColor(ROLE.citedWorkNode),
  };
}

function readLiteratureNoteGroupColor(): GraphColor {
  const rgb = document.body.classList.contains("theme-dark")
    ? 0xf0793f
    : 0xe8622c;
  return (
    readThemeColor({
      property: themeProperty.graphLiteratureNote,
      fallback: `#${rgb.toString(16)}`,
    }) ?? { a: 1, rgb }
  );
}

export function readThemeColor(role: ThemeColorRole): GraphColor | null {
  const stated = getComputedStyle(document.body).getPropertyValue(
    role.property,
  );
  const probe = document.body.appendChild(createDiv());
  const value = stated.trim() ? role.property : role.fallback;
  probe.style.color = value.startsWith("--") ? `var(${value})` : value;
  const { color, opacity } = getComputedStyle(probe);
  probe.remove();
  const parsed = parseGraphColor(color, opacity);
  if (!parsed) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug(
        "Theme states no colour for a graph role; left native",
      ).pipe(
        Effect.annotateLogs({
          property: role.property,
          color,
        }),
        withLogCategory("graph-citations"),
      ),
    );
  }
  return parsed;
}

export function stampNodeColors(
  data: GraphData,
  additions: GraphCitationAdditions,
  colors: NodeColors,
): void {
  for (const [id, node] of Object.entries(data.nodes)) {
    if (node.color) continue;
    const color = additions.citedWorkNodes.has(id)
      ? colors.citedWorkNode
      : null;
    if (color) node.color = color;
  }
}

export function installNodeColors(
  renderer: GraphLeafMembers["renderer"],
  installation: {
    readonly additions: GraphCitationAdditions;
    handedOff?(data: GraphData): void;
  },
  colors: GraphNodeColors,
): Disposable {
  return disposable(
    around(renderer, {
      setData: (setData) => (data) => {
        stampNodeColors(data, installation.additions, colors.current());
        const result = setData.call(renderer, data);
        installation.handedOff?.(data);
        return result;
      },
    }),
  );
}

const RGB = regex(
  "^rgba?\\((?<r>\\d+),\\s*(?<g>\\d+),\\s*(?<b>\\d+)(?:,\\s*(?<a>\\d*\\.?\\d+))?\\)$",
);

export function parseGraphColor(
  color: string,
  opacity: string,
): GraphColor | null {
  const channels = channelsOf(color.trim());
  if (!channels) return null;
  const fade = Number.parseFloat(opacity);
  return {
    a: channels.a * (Number.isFinite(fade) ? fade : 1),
    rgb: (channels.r << 16) | (channels.g << 8) | channels.b,
  };
}

interface Channels {
  r: number;
  g: number;
  b: number;
  a: number;
}

function channelsOf(color: string): Channels | null {
  const rgb = RGB.exec(color);
  if (!rgb) return paintedChannels(color);
  return {
    r: Number.parseInt(rgb.groups.r, 10),
    g: Number.parseInt(rgb.groups.g, 10),
    b: Number.parseInt(rgb.groups.b, 10),
    a: rgb.groups.a === undefined ? 1 : Number.parseFloat(rgb.groups.a),
  };
}

const REFUSED = "#010203";

function paintedChannels(color: string): Channels | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const painter = new OffscreenCanvas(1, 1).getContext("2d", {
    willReadFrequently: true,
  });
  if (!painter) return null;
  painter.fillStyle = REFUSED;
  painter.fillStyle = color;
  if (painter.fillStyle === REFUSED) return null;
  painter.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = painter.getImageData(0, 0, 1, 1).data;
  return { r: r!, g: g!, b: b!, a: a! / 255 };
}
