declare module "*.css" {}

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}

declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare module "*.yaml?raw" {
  const source: string;
  export default source;
}

declare module "*.lua?raw" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=cli" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=sandbox" {
  const source: string;
  export default source;
}

declare module "virtual:zotero-reads-worker" {
  const source: string;
  export default source;
}

declare module "virtual:zotero-reads-web-worker" {
  const source: () => string;
  export default source;
}

declare module "virtual:temporal-piece" {
  const source: () => string;
  export default source;
}

declare module "virtual:citation-parse-worker" {
  const source: string;
  export default source;
}

let __DEV__: boolean;
let __MIN_ELECTRON_VERSION__: string;
let __SQLITE_ENGINE_VERSION__: string;
let __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
