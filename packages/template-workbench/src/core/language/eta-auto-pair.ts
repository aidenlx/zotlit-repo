// Eta host adapter for the shared template input rules.
import type { Extension } from "@codemirror/state";

import { templatePairing } from "./pairing.ts";

export function etaAutoPair(): Extension {
  return templatePairing(() => ({ language: "eta" }));
}
