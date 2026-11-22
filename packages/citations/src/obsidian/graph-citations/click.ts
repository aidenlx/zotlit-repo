import type { NavigationPane } from "#obsidian/citekey-navigation/index.ts";
import { Effect } from "effect";
import { around } from "monkey-around";
import { Keymap } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import type { GraphLeafMembers } from "./install.ts";

export interface NodeClickDeps {
  citekeyOf: (id: string) => string | undefined;
  open: (citekey: string, pane: NavigationPane) => void;
}

export function wrapNodeClick(
  renderer: GraphLeafMembers["renderer"],
  deps: NodeClickDeps,
): Disposable {
  return disposable(
    around(renderer, {
      onNodeClick: (native) => (evt, id, type) => {
        const citekey = deps.citekeyOf(id);
        if (citekey === undefined) return native(evt, id, type);
        const pane = Keymap.isModEvent(evt);
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Cited Work Node clicked").pipe(
            Effect.annotateLogs({ citekey, pane }),
            withLogCategory("graph-citations"),
          ),
        );
        deps.open(citekey, pane);
      },
    }),
  );
}
