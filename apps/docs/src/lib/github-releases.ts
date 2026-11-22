import { repoUrl } from "./shared.ts";

export type ReleaseChannel = "pre-release" | "stable";

export const releasesUrl = `${repoUrl}/releases`;

export function tagUrl(tag: string) {
  return `${releasesUrl}/tag/${tag}`;
}

export function assetUrl(tag: string, asset: string) {
  return `${releasesUrl}/download/${tag}/${asset}`;
}

export const installPageSlugs = ["install-zotlit", "install-companion"];

export const installLessonSlugs = ["connect-zotero-to-obsidian"];
