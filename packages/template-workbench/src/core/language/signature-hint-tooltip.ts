import type { EditorState, Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Tooltip, TooltipView, ViewUpdate } from "@codemirror/view";
import { showTooltip } from "@codemirror/view";

import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";

import { fieldPopup } from "./field-popup.ts";
import { appendProse } from "./prose.ts";
import type {
  HintSignature,
  SignatureHintOptions,
  SignatureHintResult,
} from "./signature-hint.ts";
import { signatureAt } from "./signature-hint.ts";

export const SIGNATURE_HINT_CLASS = themeHook.signatureHint;

const dismiss = StateEffect.define<null>();

interface HintTooltip extends Tooltip {
  readonly hint: SignatureHintResult;
}

function renderSignature(
  doc: Document,
  callee: string,
  { parameters, active, returns, description }: HintSignature,
): HTMLElement {
  const block = doc.createElement("div");
  const label = block.appendChild(doc.createElement("code"));
  label.append(`${callee}(`);
  parameters.forEach((parameter, at) => {
    if (at > 0) label.append(", ");
    const { text } = parameter;
    if (at === active)
      label.appendChild(doc.createElement("mark")).textContent = text;
    else label.append(text);
  });
  label.append(`) → ${returns}`);
  appendProse(block.appendChild(doc.createElement("div")), description);
  return block;
}

export function signatureHint(options: SignatureHintOptions = {}): Extension {
  const create = (view: EditorView): TooltipView => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = SIGNATURE_HINT_CLASS;
    let blocks: readonly HTMLElement[] = [];
    const render = ({ callee, signatures }: SignatureHintResult) => {
      for (const block of blocks) block.remove();
      blocks = signatures.map((each) => renderSignature(doc, callee, each));
      const fragment = doc.createDocumentFragment();
      fragment.append(...blocks);
      dom.insertBefore(fragment, dom.firstChild);
    };
    render(view.state.field(hint)!.hint);
    const show = (shown: EditorView) => {
      dom.style.visibility = shown.hasFocus ? "" : "hidden";
    };
    return {
      dom,
      mount: show,
      update: (update: ViewUpdate) => {
        if (update.focusChanged) show(update.view);
        const current = update.state.field(hint);
        if (current && current !== update.startState.field(hint))
          render(current.hint);
      },
    };
  };
  const hintTooltip = (state: EditorState): HintTooltip | null => {
    const { main } = state.selection;
    if (!main.empty) return null;
    const found = signatureAt(state.doc.toString(), main.head, options);
    return (
      found && {
        pos: found.open,
        above: true,
        arrow: true,
        create,
        hint: found,
      }
    );
  };
  const hint = StateField.define<HintTooltip | null>({
    create: hintTooltip,
    update: (value, tr) =>
      tr.effects.some((effect) => effect.is(dismiss))
        ? null
        : tr.docChanged || tr.selection
          ? hintTooltip(tr.state)
          : value,
    provide: (field) => showTooltip.from(field),
  });
  return [
    hint,
    fieldPopup.of((view) =>
      view.state.field(hint)
        ? {
            close: (shown: EditorView) => {
              shown.dispatch({ effects: dismiss.of(null) });
              return true;
            },
          }
        : null,
    ),
  ];
}
