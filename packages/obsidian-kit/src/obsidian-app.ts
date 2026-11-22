import { Context } from "effect";
import type { App } from "obsidian";

export class ObsidianApp extends Context.Service<ObsidianApp, App>()(
  "zotlit/obsidian/ObsidianApp",
) {}
