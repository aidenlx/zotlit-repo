import type { IconName } from "obsidian";

const FALLBACK_ICON: IconName = "file";

export const ITEM_TYPE_ICONS: Readonly<Record<string, IconName>> = {
  artwork: "palette",
  audioRecording: "audio-lines",
  bill: "scale",
  blogPost: "globe",
  book: "book",
  bookSection: "book-open",
  case: "scale",
  computerProgram: "code",
  conferencePaper: "presentation",
  dataset: "database",
  dictionaryEntry: "book-a",
  document: "file",
  email: "mail",
  encyclopediaArticle: "book-text",
  film: "film",
  forumPost: "messages-square",
  hearing: "landmark",
  instantMessage: "message-square-text",
  interview: "mic",
  journalArticle: "newspaper",
  letter: "mail",
  magazineArticle: "newspaper",
  manuscript: "scroll-text",
  map: "map",
  newspaperArticle: "newspaper",
  patent: "award",
  podcast: "audio-lines",
  preprint: "file-pen",
  presentation: "presentation",
  radioBroadcast: "radio",
  report: "file-chart-column",
  standard: "file-badge",
  statute: "scale",
  thesis: "graduation-cap",
  tvBroadcast: "tv",
  videoRecording: "film",
  webpage: "globe",
};

export function itemTypeIcon(itemType: string | null): IconName {
  return itemType !== null && Object.hasOwn(ITEM_TYPE_ICONS, itemType)
    ? ITEM_TYPE_ICONS[itemType]!
    : FALLBACK_ICON;
}
