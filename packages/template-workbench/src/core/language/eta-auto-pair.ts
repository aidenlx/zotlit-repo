import type { Extension } from "@codemirror/state";

import { templatePairing } from "./pairing.ts";

export function etaAutoPair(): Extension {
  return templatePairing(() => ({ language: "eta" }));
}
