import { around } from "monkey-around";
import type { GraphEngine, GraphOptions, GraphView, View } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";

import {
  CITATION_POPOVER,
  COLOR_CITATION_LINKS,
  DISPLAY_DEFAULTS,
} from "./display.ts";
import { FILTER_DEFAULTS } from "./filters.ts";
import { membersPresent } from "./install.ts";

const VIEW_STATE_DEFAULTS = { ...DISPLAY_DEFAULTS, ...FILTER_DEFAULTS };

export function installGraphViewState(
  view: View,
  engine: GraphEngine,
): Disposable {
  if (view.getViewType() !== "graph") return new DisposableStack();
  const graph = view as GraphView;
  if (
    !membersPresent(
      "Graph view state unavailable; options remain native",
      {
        "view.getState": typeof graph.getState === "function",
        "view.setState": typeof graph.setState === "function",
        "view.onload": typeof graph.onload === "function",
        "view.onOptionsChange": typeof graph.onOptionsChange === "function",
        "engine.getOptions": typeof engine.getOptions === "function",
        "engine.setOptions": typeof engine.setOptions === "function",
      },
      {},
    )
  )
    return new DisposableStack();

  return disposable(
    around(graph, {
      getState: (native) =>
        function (this: GraphView) {
          return {
            ...native.call(this),
            options: structuredClone(engine.getOptions!()),
          };
        },
      setState: (native) =>
        function (this: GraphView, state, result) {
          const options = (state as { options?: GraphOptions } | null)?.options;
          if (options)
            engine.setOptions!({
              ...VIEW_STATE_DEFAULTS,
              ...options,
            });
          return native.call(this, state, result);
        },
      onload: (native) =>
        function (this: GraphView) {
          native.call(this);
          engine.setOptions!({
            [COLOR_CITATION_LINKS]: DISPLAY_DEFAULTS[COLOR_CITATION_LINKS],
            [CITATION_POPOVER]: DISPLAY_DEFAULTS[CITATION_POPOVER],
            ...FILTER_DEFAULTS,
          });
        },
      onOptionsChange: () =>
        function (this: GraphView) {
          this.app.workspace.requestSaveLayout();
        },
    }),
  );
}
