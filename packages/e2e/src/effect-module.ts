import { createRequire } from "node:module";
import { join } from "node:path";

export const EFFECT_MODULE_PATH = createRequire(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "apps",
    "obsidian",
    "package.json",
  ),
).resolve("effect");
