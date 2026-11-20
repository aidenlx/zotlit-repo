export * from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";

export function loadPdfJs(): Promise<never> {
  return Promise.reject(new Error("The trial reads no legacy text"));
}
