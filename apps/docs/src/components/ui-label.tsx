import { asMarkdown, md } from "fumadocs-core/server";

import type { LocalizedString } from "@/paraglide/runtime.js";

export interface UiLabelProps {
  name: LocalizedString;
}

export function UiLabel({ name }: UiLabelProps) {
  if (asMarkdown()) {
    return md`**${name}**`;
  }

  return <strong>{name}</strong>;
}
