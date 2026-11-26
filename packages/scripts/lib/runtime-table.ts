import { builtinModules } from "node:module";

export interface Runtime {
  readonly title: string;
  readonly modules: readonly string[];
  readonly conditions: readonly string[];
}

export const PLATFORM_MODULES: Readonly<
  Record<string, "obsidian" | "node" | "electron">
> = {
  obsidian: "obsidian",
  electron: "electron",
  "@electron/remote": "electron",
  "@effect/platform-node": "node",
};

const EDITOR_MODULES = [
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

const DESKTOP_RENDERER_NODE_MODULES = [
  "module",
  "node:async_hooks",
  "node:buffer",
  "node:child_process",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:http",
  "node:http2",
  "node:https",
  "node:module",
  "node:net",
  "node:os",
  "node:path",
  "node:path/posix",
  "node:sqlite",
  "node:stream",
  "node:stream/consumers",
  "node:string_decoder",
  "node:tls",
  "node:url",
  "node:util",
  "node:zlib",
];

const NODE_BUILTINS = [
  ...builtinModules,
  "original-fs",
  "original-fs/promises",
].flatMap((name) => [name, `node:${name}`]);

const NODE_CONDITIONS = ["module", "node", "development|production"];
const BROWSER_CONDITIONS = ["module", "browser", "development|production"];

export const RUNTIMES = {
  desktopRenderer: {
    title: "the desktop Obsidian renderer",
    modules: ["obsidian", ...EDITOR_MODULES, ...DESKTOP_RENDERER_NODE_MODULES],
    conditions: NODE_CONDITIONS,
  },
  desktopWorker: {
    title: "the desktop Worker",
    modules: NODE_BUILTINS,
    conditions: NODE_CONDITIONS,
  },
  mobileRenderer: {
    title: "the Obsidian Mobile renderer",
    modules: ["obsidian", ...EDITOR_MODULES],
    conditions: BROWSER_CONDITIONS,
  },
  obsidianModule: {
    title: "the obsidian module alone",
    modules: ["obsidian"],
    conditions: BROWSER_CONDITIONS,
  },
} as const satisfies Record<string, Runtime>;
