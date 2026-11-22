export type NotFoundSignal = "db-file-missing" | "changed" | "layout-change";

export function notFoundNoticeChange(
  signal: NotFoundSignal,
  { shown, libraryOpen }: { shown: boolean; libraryOpen: boolean },
): "show" | "hide" | null {
  switch (signal) {
    case "db-file-missing":
      return shown || libraryOpen ? null : "show";
    case "changed":
      return shown ? "hide" : null;
    case "layout-change":
      return shown && libraryOpen ? "hide" : null;
  }
}
