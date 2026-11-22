import type { ShellServices } from "@zotlit/plugin-shell/obsidian/runtime.ts";

import type { features } from "./features.ts";

export type E2eServices = ShellServices<typeof features>;
