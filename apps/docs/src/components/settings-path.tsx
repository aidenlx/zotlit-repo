import { asMarkdown, md } from "fumadocs-core/server";

// The Settings Path — the navigation route from Obsidian Settings through a
// plugin tab (ZotLit, or ZotLit Reader), optionally to a settings page and one
// setting on it, rendered as one bold unit. The `Settings` segment and the
// plugin name are literal prose owned by Obsidian and the plugin tab.
import * as m from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

/** The plugin whose settings tab the path goes through. */
type SettingsPathPlugin = "ZotLit" | "ZotLit Reader";

export type SettingsPathProps = { plugin?: SettingsPathPlugin } & (
  | { page?: never; setting?: never }
  | {
      /** ZotLit settings page name rendered from the product Message catalog. */
      page: LocalizedString;
      /** A setting on that page, rendered from the product Message catalog. */
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
