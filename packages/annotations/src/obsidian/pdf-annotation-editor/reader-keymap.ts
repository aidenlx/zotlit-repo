import { Scope } from "obsidian";
import type { App, Modifier } from "obsidian";

import { inTextEntry } from "./capability-affordance.ts";

export type HistoryVerb = "undo" | "redo";

interface HistoryChord {
  modifiers: readonly Modifier[];
  key: string;
  verb: HistoryVerb;
}

const MAC_CHORDS: readonly HistoryChord[] = [
  { modifiers: ["Meta"], key: "Z", verb: "undo" },
  { modifiers: ["Meta", "Shift"], key: "Z", verb: "redo" },
];

const PC_CHORDS: readonly HistoryChord[] = [
  { modifiers: ["Ctrl"], key: "Z", verb: "undo" },
  { modifiers: ["Ctrl", "Shift"], key: "Z", verb: "redo" },
  { modifiers: ["Ctrl"], key: "Y", verb: "redo" },
];

const MODIFIERS = ["Ctrl", "Meta", "Alt", "Shift"] as const;

export type HistoryKeystroke = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

const MODIFIER_HELD = {
  Ctrl: (event: HistoryKeystroke) => event.ctrlKey,
  Meta: (event: HistoryKeystroke) => event.metaKey,
  Alt: (event: HistoryKeystroke) => event.altKey,
  Shift: (event: HistoryKeystroke) => event.shiftKey,
} as const;

export function historyChords(isMacOS: boolean): readonly HistoryChord[] {
  return isMacOS ? MAC_CHORDS : PC_CHORDS;
}

export function historyVerbOf(
  event: HistoryKeystroke,
  isMacOS: boolean,
): HistoryVerb | null {
  const chord = historyChords(isMacOS).find(
    ({ modifiers, key }) =>
      key.toLowerCase() === event.key.toLowerCase() &&
      MODIFIERS.every(
        (name) => modifiers.includes(name) === MODIFIER_HELD[name](event),
      ),
  );
  return chord?.verb ?? null;
}

export interface ReaderKeymapVerbs {
  escape: () => boolean;
  undo: () => void;
  redo: () => void;
  copy: () => boolean;
}

export function mountReaderKeymap(
  view: { scope: Scope | null; app: App },
  verbs: ReaderKeymapVerbs,
  platform: { isMacOS: boolean },
): () => void {
  const own = view.scope;
  const scope = new Scope(own ?? view.app.scope);
  scope.register(null, null, (event) => {
    if (inTextEntry(event.target)) return;
    const modified =
      event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    if (event.key === "Escape" && !modified && verbs.escape()) return false;
  });
  for (const { modifiers, key } of historyChords(platform.isMacOS)) {
    scope.register([...modifiers], key, (event) => {
      if (inTextEntry(event.target)) return;
      const verb = historyVerbOf(event, platform.isMacOS);
      if (!verb) return;
      if (!event.repeat) verbs[verb]();
      return false;
    });
  }
  scope.register([platform.isMacOS ? "Meta" : "Ctrl"], "C", (event) => {
    if (inTextEntry(event.target)) return;
    if (verbs.copy()) return false;
  });
  view.scope = scope;
  return () => {
    if (view.scope === scope) view.scope = own;
  };
}
