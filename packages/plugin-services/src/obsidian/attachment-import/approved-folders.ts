import { Effect } from "effect";

import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";

const STORAGE_KEY = "zotlit-approved-attachment-folders";

export const loadApprovedFolders = DeviceStorage.use((storage) =>
  storage.load(STORAGE_KEY),
).pipe(
  Effect.map((raw): string[] => {
    if (!Array.isArray(raw)) return [];
    const folders = raw.filter(
      (entry: unknown): entry is string => typeof entry === "string" && !!entry,
    );
    return [...new Set(folders)];
  }),
);

export const saveApprovedFolders = (folders: readonly string[]) =>
  DeviceStorage.use((storage) =>
    storage.save(STORAGE_KEY, folders.length > 0 ? [...folders] : null),
  );
