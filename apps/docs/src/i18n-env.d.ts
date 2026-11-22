export {};

declare global {
  const __DOCS_CHINESE_PAGES__: string[];
  const __LEARN_MEDIA__: import("./lib/learn-media.ts").LearnMedia;
  const __MEDIA_URLS__: Record<string, string>;
  const __FIRST_COMMIT_DAYS__: Record<string, string>;
}
