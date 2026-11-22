import type { CompletionPresentation } from "#core/language/index.ts";

import { appendProse } from "#core/language/index.ts";

type Completion = Parameters<
  NonNullable<CompletionPresentation["optionClass"]>
>[0];

export interface CompletionCells {
  readonly type?: string;
  readonly note?: string;
}

export function nativeCompletion(
  cells: (completion: Completion) => CompletionCells | undefined,
): CompletionPresentation {
  return {
    tooltipClass: () => "suggestion-container zt-template-completion",
    optionClass: () => "suggestion-item mod-complex",
    addToOptions: [
      {
        position: 60,
        render(completion) {
          const type = cells(completion)?.type;
          if (!type) return null;
          return createDiv({ cls: "zt-template-completion-type", text: type });
        },
      },
      {
        position: 70,
        render(completion) {
          const note = cells(completion)?.note;
          if (!note) return null;
          const cell = createDiv({ cls: "suggestion-note" });
          appendProse(cell, note);
          return cell;
        },
      },
    ],
  };
}
