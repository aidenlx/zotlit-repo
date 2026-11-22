import type { Diagnostic } from "@codemirror/lint";
import { linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";

export const underlineOnlyLint: Extension = linter(null, {
  tooltipFilter: () => null as unknown as Diagnostic[],
});
