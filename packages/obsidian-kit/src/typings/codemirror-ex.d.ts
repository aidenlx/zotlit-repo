import "@codemirror/language";

declare module "@codemirror/language" {
  export const tokenClassNodeProp: import("@lezer/common").NodeProp<string>;
  export const lineClassNodeProp: import("@lezer/common").NodeProp<string>;
}
