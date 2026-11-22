import { asMarkdown, md } from "fumadocs-core/server";

import * as m from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

type SettingsPathPlugin = "ZotLit" | "ZotLit Reader";

export type SettingsPathProps = { plugin?: SettingsPathPlugin } & (
  | { page?: never; setting?: never }
  | {
      page: LocalizedString;
      setting?: LocalizedString;
    }
);

export function SettingsPath({
  plugin = "ZotLit",
  page,
  setting,
}: SettingsPathProps) {
  const segments = [m.docs_settings(), plugin, page, setting].filter(
    (segment) => segment !== undefined,
  );
  const path = segments.join(" > ");

  if (asMarkdown()) {
    return md`**${path}**`;
  }

  return <strong>{path}</strong>;
}
