import { around } from "monkey-around";
import type { GraphEngine, GraphOptions, GraphView, View } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";

import { CITATION_POPOVER, COLOR_CITATION_LINKS } from "./display.ts";
import {
  CITATION_CONNECTED_ONLY,
  PANDOC_CITATIONS,
  WIKILINK_CITATIONS,
} from "./filters.ts";
import { membersPresent } from "./install.ts";

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
              [COLOR_CITATION_LINKS]: false,
              [CITATION_POPOVER]: false,
              ...options,
            });
          return native.call(this, state, result);
        },
      onload: (native) =>
        function (this: GraphView) {
          native.call(this);
          engine.setOptions!({
            [COLOR_CITATION_LINKS]: false,
            [CITATION_POPOVER]: false,
            [CITATION_CONNECTED_ONLY]: false,
            [PANDOC_CITATIONS]: true,
            [WIKILINK_CITATIONS]: true,
          });
        },
      onOptionsChange: () =>
        function (this: GraphView) {
          this.app.workspace.requestSaveLayout();
        },
    }),
  );
}
