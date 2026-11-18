import type { ShellServices } from "@zotlit/plugin-shell/obsidian/runtime.ts";

import type { features } from "./features.ts";

/** Type-only boundary for code evaluated by the End-to-end Run. */
export type E2eServices = ShellServices<typeof features>;
