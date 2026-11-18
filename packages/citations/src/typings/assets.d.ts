// The Pandoc integration files the filter bundles, as text; the stylesheets
// are declared in the Obsidian kit's typings.

declare module "*.yaml?raw" {
  const source: string;
  export default source;
}

/** Built by the `pandoc-filter-variants` Vite plugin, one variant per query. */
declare module "*.lua?variant=cli" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=sandbox" {
  const source: string;
  export default source;
}
