import { docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";

export function releaseNoteUrl(version: string): string {
  return docsUrl(`/changelog/${version}`);
}

export const V1_TEMPLATE_FOLDER = "ZtTemplates";
