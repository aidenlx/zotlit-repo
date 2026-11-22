import { registerHooks } from "node:module";

const { resolve } = await import("./pdfjs-hooks.mjs");

registerHooks({ resolve });
