import { prerelease } from "semver";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";

export const RELEASE_TAG = "zotero-release";
export const UPDATE_JSON = "update.json";
export const UPDATE_BETA_JSON = "update-beta.json";

export const HOST_NOTES = "release-host-notes.md";

export function zoteroTag(version: string): string {
  return `zt-${version}`;
}

export function xpiName(version: string): string {
  return `zotlit-zotero-${version}.xpi`;
}

export function updateJsonName(version: string): string {
  return prerelease(version) ? UPDATE_BETA_JSON : UPDATE_JSON;
}

function releaseDownloadUrl(tag: string, file: string): string {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${file}`;
}

export function updateUrl(version: string): string {
  return releaseDownloadUrl(RELEASE_TAG, updateJsonName(version));
}

export function xpiDownloadUrl(version: string): string {
  return releaseDownloadUrl(zoteroTag(version), xpiName(version));
}
