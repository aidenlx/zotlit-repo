import { normalizePath } from "obsidian";

export function normalizeFolderPath(dir: string): string;
export function normalizeFolderPath(dir: string | null): string | null;
export function normalizeFolderPath(dir: string | null): string | null {
  if (dir === null) return null;
  if (dir === "." || dir === "/" || dir === "") return "/";
  return normalizePath(dir);
}

export function joinFolderPath(folder: string, name: string): string {
  return folder === "/" ? name : `${folder}/${name}`;
}
