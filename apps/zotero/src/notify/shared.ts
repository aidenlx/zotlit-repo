import { prefs } from "@/prefs/index.ts";

export function notifyEnabled(): boolean {
  return prefs.get<boolean>("extensions.zotlit.notify") === true;
}

export function notifyUrl(): string | undefined {
  const url = (prefs.get<string>("extensions.zotlit.notify-url") ?? "").trim();
  return url.length > 0 ? url : undefined;
}

export function currentSelection(
  reader: _ZoteroTypes.ReaderInstance,
  libraryID: number,
): number[] {
  const keys = reader._internalReader?._state?.selectedAnnotationIDs ?? [];
  return [...keys]
    .map((key) => Zotero.Items.getIDFromLibraryAndKey(libraryID, key))
    .filter((id): id is number => id !== false)
    .sort((a, b) => a - b);
}
