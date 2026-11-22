declare module "*.yaml?raw" {
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
