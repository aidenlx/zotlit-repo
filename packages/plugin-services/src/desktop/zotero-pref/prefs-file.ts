import type { PrefValue } from "#core/zotero-pref/service.ts";
import { parse as parseIni } from "@std/ini/parse";
import { regex } from "arkregex";
import { join } from "node:path";

export const PREF_BRANCH = "extensions.zotero.";

export const DEFAULT_ZOTERO_HTTP_PORT = 23119;

export const ZOTERO_HTTP_PORT_PREF = "httpServer.port";

export const PREFS_FILENAME = "prefs.js";

export const PROFILES_INI_FILENAME = "profiles.ini";

export const EXTENSIONS_FILENAME = "extensions.json";

export function resolveZoteroHttpPort(
  value: PrefValue | undefined,
): number | null {
  if (value === -1) return null;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 65_535
    ? value
    : DEFAULT_ZOTERO_HTTP_PORT;
}

export interface ZoteroProfile {
  name: string | null;
  path: string;
  isRelative: boolean;
  isDefault: boolean;
}

export function parseZoteroProfiles(content: string): ZoteroProfile[] {
  const ini = parseIni(content);
  const profiles: ZoteroProfile[] = [];
  for (const section of Object.values(ini)) {
    if (typeof section !== "object" || section === null) continue;
    const { Path, Name, IsRelative, Default } = section as Record<
      string,
      unknown
    >;
    if (typeof Path !== "string") continue;
    profiles.push({
      name: typeof Name === "string" ? Name : null,
      path: Path,
      isRelative: IsRelative === "1",
      isDefault: Default === "1",
    });
  }
  return profiles;
}

export function selectDefaultProfile(
  profiles: readonly ZoteroProfile[],
): ZoteroProfile | undefined {
  return profiles.find((p) => p.isDefault) ?? profiles.at(-1);
}

export function resolveProfileDir(
  root: string,
  profile: Pick<ZoteroProfile, "path" | "isRelative">,
): string {
  return profile.isRelative
    ? join(root, ...profile.path.split("/"))
    : profile.path;
}

const USER_PREF = regex(
  '^user_pref\\(\\s*(?<key>"(?:[^"\\\\]|\\\\.)*")\\s*,\\s*(?<value>.+)\\)\\s*;\\s*$',
);

export function parsePrefsJs(content: string): Map<string, PrefValue> {
  const prefs = new Map<string, PrefValue>();
  for (const line of content.split(/\r?\n|\r/)) {
    const match = USER_PREF.exec(line.trim());
    if (!match) continue;
    let key: unknown;
    let value: unknown;
    try {
      key = JSON.parse(match.groups.key);
      value = JSON.parse(match.groups.value.trim());
    } catch {
      continue;
    }
    if (typeof key === "string" && isPrefValue(value)) prefs.set(key, value);
  }
  return prefs;
}

export function isAddonActive(content: string, id: string): boolean {
  let list: unknown;
  try {
    list = JSON.parse(content);
  } catch {
    return false;
  }
  const addons = (list as { addons?: unknown } | null)?.addons;
  return (
    Array.isArray(addons) &&
    addons.some(
      (addon: { id?: unknown; active?: unknown } | null) =>
        addon?.id === id && addon.active === true,
    )
  );
}

function isPrefValue(value: unknown): value is PrefValue {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}
