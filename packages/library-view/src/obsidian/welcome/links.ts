import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";

export const docsHomeUrl = (): string => docsUrl("/docs");
export const gettingStartedUrl = (): string => docsUrl("/learn");
export const templatesDocsUrl = (): string =>
  docsUrl("/docs/reference/templates");
export const citationsDocsUrl = (): string =>
  docsUrl("/docs/how-to/insert-citations");
export const migrationGuideUrl = (): string =>
  docsUrl("/docs/how-to/migrate-from-v1");
export const blogUrl = (): string => docsUrl("/blog");
export const changelogUrl = (): string => docsUrl("/changelog");
export const GITHUB = `https://github.com/${RELEASE_REPOSITORY}`;
export const BUG_REPORT = `${GITHUB}/discussions/new?category=bug-reports`;
export const SPONSOR = "https://github.com/sponsors/aidenlx";
