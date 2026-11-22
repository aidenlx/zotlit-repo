import type { WorkbenchSliceRange } from "#core/document/index.ts";
import { StateField } from "@codemirror/state";
import type {
  EditorState,
  Extension,
  Range,
  StateEffectType,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

export class BoxWidget extends WidgetType {
  readonly box: HTMLElement;
  readonly range: WorkbenchSliceRange;

  constructor(box: HTMLElement, range: WorkbenchSliceRange) {
    super();
    this.box = box;
    this.range = range;
  }

  eq(other: BoxWidget): boolean {
    return (
      other.box === this.box &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    revealSourceOnClick(this.box, view, this.range);
    return this.box;
  }
}

export class PreviewWidget extends WidgetType {
  readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    super();
    this.host = host;
  }

  eq(other: PreviewWidget): boolean {
    return other.host === this.host;
  }

  toDOM(): HTMLElement {
    return this.host;
  }
}

export function boxAt(
  boxes: Map<number, HTMLElement>,
  index: number,
): HTMLElement {
  let box = boxes.get(index);
  if (!box) {
    box = document.createElement("span");
    boxes.set(index, box);
  }
  return box;
}

export function boxRanges(
  calls: readonly WorkbenchSliceRange[],
  boxes: Map<number, HTMLElement>,
  selection: { ranges: readonly { from: number; to: number }[] },
): Range<Decoration>[] {
  return calls.flatMap((call, index) =>
    selection.ranges.some(
      (range) => range.from <= call.to && range.to >= call.from,
    )
      ? []
      : [
          Decoration.replace({
            widget: new BoxWidget(boxAt(boxes, index), call),
          }).range(call.from, call.to),
        ],
  );
}

export function boxField(
  expand: StateEffectType<number | null>,
  build: (state: EditorState, expanded: number | null) => DecorationSet,
): Extension {
  return StateField.define<{
    expanded: number | null;
    decorations: DecorationSet;
  }>({
    create: (state) => ({ expanded: null, decorations: build(state, null) }),
    update: (value, transaction) => {
      let expanded = value.expanded;
      for (const effect of transaction.effects) {
        if (effect.is(expand)) expanded = effect.value;
      }
      return transaction.docChanged ||
        transaction.selection ||
        expanded !== value.expanded
        ? { expanded, decorations: build(transaction.state, expanded) }
        : value;
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
}

const INTERACTIVE = "button, [data-annotation-preview], [data-partial-preview]";

export function revealSourceOnClick(
  element: HTMLElement,
  view: EditorView,
  range: WorkbenchSliceRange,
): void {
  element.onclick = (event) => {
    const target = event.target as Node | null;
    if (target?.instanceOf(Element) && target.closest(INTERACTIVE)) return;
    view.focus();
    view.dispatch({
      selection: { anchor: range.to, head: range.from },
      scrollIntoView: true,
      userEvent: "select.pointer",
    });
  };
}
