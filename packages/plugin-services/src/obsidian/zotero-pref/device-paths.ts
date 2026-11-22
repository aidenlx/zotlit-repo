import type { App } from "obsidian";

export type DeviceStorage = Pick<App, "loadLocalStorage" | "saveLocalStorage">;

const STORAGE_KEY = "zotlit-zotero-paths";

export interface ZoteroPathOverrides {
  profileDir: string | null;
  dataDir: string | null;
}

export function loadZoteroPathOverrides(
  app: DeviceStorage,
): ZoteroPathOverrides {
  const raw: unknown = app.loadLocalStorage(STORAGE_KEY);
  return {
    profileDir: readPath(raw, "profileDir"),
    dataDir: readPath(raw, "dataDir"),
  };
}

export function saveZoteroPathOverrides(
  app: DeviceStorage,
  overrides: ZoteroPathOverrides,
): void {
  const record: Record<string, string> = {};
  if (overrides.profileDir) record.profileDir = overrides.profileDir;
  if (overrides.dataDir) record.dataDir = overrides.dataDir;
  app.saveLocalStorage(
    STORAGE_KEY,
    Object.keys(record).length > 0 ? record : null,
  );
}

function readPath(raw: unknown, key: keyof ZoteroPathOverrides): string | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}
