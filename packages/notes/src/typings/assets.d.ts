// The built-in templates the Templates read, as text; the stylesheets are
// declared in the Obsidian kit's typings.

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}
