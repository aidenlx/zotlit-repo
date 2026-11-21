// The Match editor's own look, and the surfaces that draw it another way: a
// surface hands `MatchEditor` the classes it gives these parts, and each part
// wears them in place of the Workbench's.
import { createContext, useContext } from "react";

import { cn } from "@zotlit/obsidian-kit/utils.ts";

/** The parts of the Match editor that a surface may draw in its own look. */
export type MatchPart =
  | "fieldset"
  | "group"
  | "actions"
  | "rows"
  | "row"
  | "handle"
  | "button"
  | "conjunction"
  | "statement"
  | "predicate"
  | "kind-icon"
  | "error";

/** The class a surface gives each part it draws itself. */
export type MatchLook = Readonly<Partial<Record<MatchPart, string>>>;

export const MatchLookContext = createContext<MatchLook>({});

/**
 * The class of `part` in the surface's look, else `base`, the Workbench's.
 *
 * @example
 *   const look = useMatchLook();
 *   <div data-part="group" className={look("group", matchGroup)} />
 */
export function useMatchLook(): (
  part: MatchPart,
  base?: string,
) => string | undefined {
  const look = useContext(MatchLookContext);
  return (part, base) => look[part] ?? base;
}

// The kind's Select trigger and the native operator, a rule between.
export const matchPredicate = cn(
  "zt:flex zt:max-w-full zt:min-w-0 zt:flex-none",
  "zt:[&>[data-part=wrapper]]:min-w-0 zt:[&>[role=combobox]]:max-w-full zt:[&>[role=combobox]]:shrink-0",
  "zt:[&>:is([role=combobox],[data-part=wrapper])]:border-border zt:[&>[role=combobox]~[data-part=wrapper]]:border-s",
);
