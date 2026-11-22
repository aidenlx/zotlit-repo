import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
  selectedCompletionIndex,
} from "@codemirror/autocomplete";
import type { CompletionSource } from "@codemirror/autocomplete";
import { Facet, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";

export interface FieldPopup {
  readonly accept?: (view: EditorView) => boolean;
  readonly close: (view: EditorView) => boolean;
}

export type FieldPopupRelease = () => void;

export interface FieldPopupKeys {
  readonly view: EditorView;
  readonly accept: () => boolean;
  readonly close: () => boolean;
  readonly released: () => void;
}

export type FieldPopupKeyHost = (keys: FieldPopupKeys) => FieldPopupRelease;

export const fieldPopupKeyHost = Facet.define<
  FieldPopupKeyHost,
  FieldPopupKeyHost | null
>({ combine: (hosts) => hosts[0] ?? null });

const popupKeymap = Prec.highest(
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey)
        return false;
      if (event.isComposing || event.keyCode === 229) return false;
      if (event.key === "Tab" || event.key === "Enter") return accept(view);
      if (event.key === "Escape") return close(view);
      return false;
    },
  }),
);

const hostHold = ViewPlugin.fromClass(
  class {
    #release: FieldPopupRelease | null = null;
    readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;

      this.sync();
    }
    update() {
      this.sync();
    }
    sync() {
      const { view } = this;
      const host = view.state.facet(fieldPopupKeyHost);
      const held = host !== null && view.hasFocus && standing(view) !== null;
      if (held && !this.#release) {
        const release: FieldPopupRelease = host({
          view,
          accept: () => accept(view),
          close: () => close(view),
          released: () => {
            if (this.#release === release) this.#release = null;
          },
        });
        this.#release = release;
      } else if (!held) this.destroy();
    }
    destroy() {
      const release = this.#release;
      this.#release = null;
      release?.();
    }
  },
  {
    eventHandlers: {
      focus() {
        this.sync();
      },
    },
  },
);

export const fieldPopup = Facet.define<(view: EditorView) => FieldPopup | null>(
  { enables: [popupKeymap, hostHold] },
);

function standing(view: EditorView): FieldPopup | null {
  for (const popup of view.state.facet(fieldPopup)) {
    const shown = popup(view);
    if (shown) return shown;
  }
  return null;
}

function accept(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  return standing(view)?.accept?.(view) ?? false;
}

function close(view: EditorView): boolean {
  if (view.compositionStarted) return false;
  return standing(view)?.close(view) ?? false;
}

const completionList = Prec.high(
  fieldPopup.of((view) =>
    selectedCompletionIndex(view.state) === null
      ? null
      : { accept: acceptCompletion, close: closeCompletion },
  ),
);

export type CompletionPresentation = Pick<
  NonNullable<Parameters<typeof autocompletion>[0]>,
  "tooltipClass" | "optionClass" | "addToOptions"
>;

export function syntaxCompletion(
  source: CompletionSource,
  presentation: CompletionPresentation = {},
): Extension {
  return [
    autocompletion({
      override: [source],
      icons: false,
      defaultKeymap: false,
      ...presentation,
    }),
    Prec.highest(
      keymap.of(
        completionKeymap.filter(
          ({ key }) => key !== "Enter" && key !== "Escape",
        ),
      ),
    ),
    completionList,
  ];
}
