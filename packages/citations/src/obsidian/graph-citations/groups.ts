import { Effect } from "effect";
import { around } from "monkey-around";
import type {
  GraphColor,
  GraphColorGroupSection,
  GraphEngine,
  GraphOptions,
} from "obsidian";

import { FIELD_ZOTERO_KEY } from "@zotlit/plugin-kernel/constants.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { targetOnce } from "./install.ts";
import type { GraphNodeColors } from "./node-color.ts";

export const LITERATURE_NOTES_QUERY = `["${FIELD_ZOTERO_KEY}"]`;

const PROBE_KEY = "color-groups";

export interface GroupsEngine {
  setOptions(options: GraphOptions): void;
}

export interface GroupsTarget {
  engine: GroupsEngine;
  section: GraphColorGroupSection;
}

export function groupsTarget(engine: GraphEngine): GroupsTarget | null {
  const section = engine.colorGroupOptions;
  return targetOnce(engine, {
    key: PROBE_KEY,
    message: "Graph Groups section is missing a member; no button built",
    present: {
      "engine.setOptions": typeof engine.setOptions === "function",
      "engine.colorGroupOptions": Boolean(section),
      "section.childrenEl": Boolean(section?.childrenEl),
      "section.getColoredQueries":
        typeof section?.getColoredQueries === "function",
      "section.setColorQueries": typeof section?.setColorQueries === "function",
    },
    context: { section: PROBE_KEY },
    build: () => ({ engine: engine as GroupsEngine, section: section! }),
  });
}

export function addLiteratureNotesGroup(
  target: GroupsTarget,
  color: GraphColor,
): boolean {
  const groups = target.section.getColoredQueries();
  if (groups.some((group) => group.query === LITERATURE_NOTES_QUERY)) {
    Effect.runSyncWith(logServices)(
      Effect.logDebug(
        "Literature notes group already present; none added",
      ).pipe(withLogCategory("graph-citations")),
    );
    return false;
  }
  target.engine.setOptions({
    colorGroups: [...groups, { query: LITERATURE_NOTES_QUERY, color }],
  });
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Literature notes group added").pipe(
      Effect.annotateLogs({ groups: groups.length + 1 }),
      withLogCategory("graph-citations"),
    ),
  );
  return true;
}

export function installGroupsButton(
  engine: GraphEngine,
  colors: GraphNodeColors,
): Disposable {
  const restores = new DisposableStack();
  const target = groupsTarget(engine);
  if (!target) return restores;
  const { section } = target;
  const container = section.childrenEl.createDiv(
    "graph-color-button-container",
    (el) => {
      el.createEl(
        "button",
        { text: m.graph_citations_add_literature_notes_group() },
        (button) => {
          button.addEventListener("click", () => {
            addLiteratureNotesGroup(target, colors.literatureNoteGroupColor());
          });
        },
      );
    },
  );
  restores.defer(
    around(section, {
      setColorQueries: (setColorQueries) =>
        function (this: GraphColorGroupSection, queries) {
          setColorQueries.call(this, queries);
          this.childrenEl.append(container);
        },
    }),
  );
  restores.defer(() => container.remove());
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Graph groups button installed").pipe(
      withLogCategory("graph-citations"),
    ),
  );
  return restores;
}
