import { createContext, useContext } from "react";

import { cn } from "@zotlit/obsidian-kit/utils.ts";

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

export type MatchLook = Readonly<Partial<Record<MatchPart, string>>>;

export const MatchLookContext = createContext<MatchLook>({});

export function useMatchLook(): (
  part: MatchPart,
  base?: string,
) => string | undefined {
  const look = useContext(MatchLookContext);
  return (part, base) => look[part] ?? base;
}

export const matchPredicate = cn(
  "zt:flex zt:max-w-full zt:min-w-0 zt:flex-none",
  "zt:[&>[data-part=wrapper]]:min-w-0 zt:[&>[role=combobox]]:max-w-full zt:[&>[role=combobox]]:shrink-0",
  "zt:[&>:is([role=combobox],[data-part=wrapper])]:border-border zt:[&>[role=combobox]~[data-part=wrapper]]:border-s",
);
