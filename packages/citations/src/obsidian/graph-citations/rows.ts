import { Effect } from "effect";
import { around } from "monkey-around";
import { Setting } from "obsidian";
import type { GraphControlSection, GraphEngine, GraphOptions } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { targetOnce } from "./install.ts";

export type GraphSectionName = "filter" | "display";

const SECTIONS = {
  filter: "filterOptions",
  display: "displayOptions",
} as const satisfies Record<GraphSectionName, keyof GraphEngine>;

export interface RowEngine {
  options: GraphOptions;
  render(): unknown;
  onOptionsChange(): void;
}

export interface ToggleRowTarget {
  engine: RowEngine;
  section: GraphControlSection;
  saved: GraphOptions | null;
}

export interface ToggleRow {
  key: string;
  name: string;
  tooltip: string;
  defaultValue: boolean;
}

export interface ToggleRowTargetOptions {
  section: GraphSectionName;
  saved: GraphOptions | null;
}

export function toggleRowTarget(
  engine: GraphEngine,
  options: ToggleRowTargetOptions,
): ToggleRowTarget | null {
  const { section: name } = options;
  const member = SECTIONS[name];
  const section = engine[member];
  return targetOnce(engine, {
    key: name,
    message: "Graph controls section is missing a member; no rows built",
    present: {
      "engine.options": Boolean(engine.options),
      "engine.render": typeof engine.render === "function",
      "engine.onOptionsChange": typeof engine.onOptionsChange === "function",
      [`engine.${member}`]: Boolean(section),
      "section.childrenEl": Boolean(section?.childrenEl),
      "section.optionListeners": Boolean(section?.optionListeners),
      "section.setDefaultOptions":
        typeof section?.setDefaultOptions === "function",
    },
    context: { section: name },
    build: () => ({
      engine: engine as RowEngine,
      section: section!,
      saved: options.saved,
    }),
  });
}

export function installToggleRow(
  target: ToggleRowTarget,
  row: ToggleRow,
): Disposable {
  const { engine, section } = target;
  const value = rowValue(target, row);
  engine.options[row.key] = value;
  const setting = new Setting(section.childrenEl)
    .setName(row.name)
    .setTooltip(row.tooltip)
    .setClass("mod-toggle")
    .addToggle((toggle) =>
      toggle
        .setValue(value)
        .registerOptionListener(section.optionListeners, row.key)
        .onChange((next) => {
          engine.options[row.key] = next;
          Effect.runSyncWith(logServices)(
            Effect.logDebug("Graph row changed").pipe(
              Effect.annotateLogs({ key: row.key, value: next }),
              withLogCategory("graph-citations"),
            ),
          );
          engine.render();
          engine.onOptionsChange();
        }),
    );
  const restores = new DisposableStack();
  restores.defer(
    around(section, {
      setDefaultOptions: (native) => {
        return function (this: GraphControlSection) {
          native.call(this);
          section.optionListeners[row.key]?.(row.defaultValue);
        };
      },
    }),
  );
  restores.defer(() => {
    setting.settingEl.remove();
    delete section.optionListeners[row.key];
  });
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Graph row installed").pipe(
      Effect.annotateLogs({ key: row.key, value }),
      withLogCategory("graph-citations"),
    ),
  );
  return restores;
}

export function rowFlag(
  engine: { options?: GraphOptions },
  key: string,
  defaultValue: boolean,
): boolean {
  const value = engine.options?.[key];
  return typeof value === "boolean" ? value : defaultValue;
}

function rowValue(target: ToggleRowTarget, row: ToggleRow): boolean {
  for (const options of [target.engine.options, target.saved]) {
    const value = options?.[row.key];
    if (typeof value === "boolean") return value;
  }
  return row.defaultValue;
}
