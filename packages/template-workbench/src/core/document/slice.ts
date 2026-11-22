import { defaultKeymap, isolateHistory } from "@codemirror/commands";
import {
  Annotation,
  EditorSelection,
  ChangeSet,
  Prec,
  Text,
  Transaction,
} from "@codemirror/state";
import type { ChangeSpec, Extension, StateEffect } from "@codemirror/state";
import { ViewPlugin, keymap } from "@codemirror/view";
import type { EditorView, PluginValue, ViewUpdate } from "@codemirror/view";

import { sliceEdit } from "./controller.ts";
import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
  WorkbenchSliceRange,
} from "./controller.ts";
import { isJson, jsonSliceEdit } from "./json-source.ts";
import { jsonCodec, sourceCodec } from "./slice-codec.ts";
import type { SliceCodec } from "./slice-codec.ts";

import {
  addPair,
  pairingState,
  restorePairs,
  offsetPair,
  slicePairs,
} from "#core/language/pairing-state.ts";

const fromMaster = Annotation.define<boolean>();

export function workbenchSlice(
  controller: WorkbenchDocumentController,
  id: WorkbenchSliceId,
): Extension {
  return [
    pairingState.init(() =>
      controller.sliceCodec(id) === sourceCodec
        ? slicePairs(controller.state, controller.sliceRange(id))
        : [],
    ),
    Prec.highest(
      keymap.of([
        { key: "Mod-z", preventDefault: true, run: () => controller.undo() },
        {
          key: "Mod-y",
          mac: "Mod-Shift-z",
          preventDefault: true,
          run: () => controller.redo(),
        },
      ]),
    ),
    keymap.of(defaultKeymap),
    ViewPlugin.define((view) => new SliceSync(view, controller, id)),
  ];
}

export function sliceShownText(
  controller: WorkbenchDocumentController,
  id: WorkbenchSliceId,
): string {
  return controller
    .sliceCodec(id)
    .show(controller.sliceText(id), controller.slicePrefix(id));
}

export function sliceOffsets(
  controller: WorkbenchDocumentController,
  id: WorkbenchSliceId,
  shown: string,
) {
  const codec = controller.sliceCodec(id);
  const stored = controller.sliceText(id);
  return {
    toStored: (position: number) => codec.toStored(shown, stored, position),
    toShown: (position: number) => codec.toShown(stored, shown, position),
  };
}

class SliceSync implements PluginValue {
  #range: WorkbenchSliceRange;
  #pushing = false;
  readonly #unsubscribe: () => void;
  readonly #unregister: () => void;

  readonly view: EditorView;
  readonly controller: WorkbenchDocumentController;
  readonly id: WorkbenchSliceId;

  constructor(
    view: EditorView,
    controller: WorkbenchDocumentController,
    id: WorkbenchSliceId,
  ) {
    this.view = view;
    this.controller = controller;
    this.id = id;

    this.#range = controller.sliceRange(id);
    this.#unsubscribe = controller.subscribe((update) => {
      if (
        update.docChanged ||
        update.transaction.effects.some((effect) => effect.is(jsonSliceEdit))
      )
        this.#pull(update.transaction);
    });
    this.#unregister = controller.registerSlice(id, {
      replay: (changes, userEvent) => {
        const { codec } = this;
        const source = controller.sliceText(id);
        const edit = ChangeSet.of(changes, source.length);
        if (this.json && !isJson(source)) {
          const edited = edit.apply(Text.of(source.split("\n"))).toString();
          this.view.dispatch({
            changes: {
              from: 0,
              to: this.view.state.doc.length,
              insert: codec.show(edited, controller.slicePrefix(id)),
            },
            ...(userEvent === undefined ? {} : { userEvent }),
          });
          return;
        }
        const shown = this.view.state.doc.toString();
        const mapped: ChangeSpec[] = [];
        // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
        edit.iterChanges((from, to, _fromB, _toB, inserted) => {
          mapped.push({
            from: codec.toShown(source, shown, from),
            to: codec.toShown(source, shown, to),
            insert: inserted.toString(),
          });
        });
        this.view.dispatch({
          changes: mapped,
          ...(userEvent === undefined ? {} : { userEvent }),
        });
      },
    });
  }

  get codec(): SliceCodec {
    return this.controller.sliceCodec(this.id);
  }

  get json(): boolean {
    return this.codec === jsonCodec;
  }

  update(update: ViewUpdate): void {
    if (update.focusChanged) {
      this.controller.setFocusedSlice(update.view.hasFocus ? this.id : null);
    }
    for (const transaction of update.transactions) {
      if (!transaction.docChanged || transaction.annotation(fromMaster)) {
        continue;
      }
      this.#push(transaction);
    }
  }

  destroy(): void {
    this.#unregister();
    this.#unsubscribe();
    this.controller.setFocusedSlice(null);
  }

  #push(transaction: Transaction): void {
    const { from } = this.#range;
    const { codec } = this;
    const changes: ChangeSpec[] = [];
    // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
    transaction.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({
        from: from + fromA,
        to: from + toA,
        insert: inserted.toString(),
      });
    });

    let head = transaction.state.selection.main.head;
    const effects: StateEffect<unknown>[] =
      codec === sourceCodec
        ? transaction.effects
            .filter((effect) => effect.is(addPair))
            .map((effect) => addPair.of(offsetPair(effect.value, from)))
        : [];
    let grown = transaction.newDoc.length - transaction.startState.doc.length;
    const source = this.controller.sliceText(this.id);
    if (codec !== sourceCodec) {
      const display = transaction.newDoc.toString();
      const stored = codec.store(display, source);
      let left = 0;
      while (
        left < source.length &&
        left < stored.length &&
        source[left] === stored[left]
      )
        left++;
      let right = source.length;
      let end = stored.length;
      while (
        right > left &&
        end > left &&
        source[right - 1] === stored[end - 1]
      ) {
        right--;
        end--;
      }
      const gap =
        source === "" &&
        stored !== "" &&
        !/\s/.test(this.controller.slicePrefix(this.id).at(-1) ?? " ")
          ? " "
          : "";
      changes.length = 0;
      if (left !== right || left !== end)
        changes.push({
          from: from + left,
          to: from + right,
          insert: gap + stored.slice(left, end),
        });
      if (this.json) {
        effects.push(
          jsonSliceEdit.of({
            id: this.id,
            before: {
              text: transaction.startState.doc.toString(),
              head: transaction.startState.selection.main.head,
            },
            after: { text: display, head },
          }),
        );
      }
      head = codec.toStored(display, stored, head) + gap.length;
      grown = gap.length + stored.length - source.length;
    }
    head = Math.min(from + head, this.controller.state.doc.length + grown);
    const userEvent = transaction.annotation(Transaction.userEvent);
    const isolation = transaction.annotation(isolateHistory);
    if (!this.json) {
      this.controller.dispatch({
        selection: EditorSelection.cursor(
          from +
            codec.toStored(
              transaction.startState.doc.toString(),
              source,
              transaction.startState.selection.main.head,
            ),
        ),
        annotations: Transaction.addToHistory.of(false),
      });
    }
    this.#pushing = true;
    try {
      this.controller.dispatch({
        changes,
        effects,
        selection: EditorSelection.cursor(head),
        annotations: [
          sliceEdit.of(this.id),
          ...(isolation ? [isolateHistory.of(isolation)] : []),
        ],
        ...(userEvent === undefined ? {} : { userEvent }),
      });
    } finally {
      this.#pushing = false;
    }
  }

  #pull(transaction: Transaction): void {
    const previous = this.#range;
    this.#range = this.controller.sliceRange(this.id);
    if (this.json && this.#pushing) return;
    const { codec } = this;
    const source = this.controller.sliceText(this.id);
    const draft = this.json
      ? transaction.effects.findLast(
          (effect) => effect.is(jsonSliceEdit) && effect.value.id === this.id,
        )?.value.after
      : undefined;
    const text =
      draft?.text ?? codec.show(source, this.controller.slicePrefix(this.id));
    const pairs = codec === sourceCodec;
    if (text === this.view.state.doc.toString() && !draft) {
      if (pairs && transaction.annotation(sliceEdit) !== this.id) {
        this.view.dispatch({
          effects: restorePairs.of(
            slicePairs(this.controller.state, this.#range),
          ),
          annotations: fromMaster.of(true),
        });
      }
      return;
    }
    const oldHead = codec.toStored(
      this.view.state.doc.toString(),
      transaction.startState.sliceDoc(previous.from, previous.to),
      this.view.state.selection.main.head,
    );
    const masterHead = Math.min(
      Math.max(
        (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")
          ? transaction.state.selection.main.head
          : transaction.changes.mapPos(previous.from + oldHead)) -
          this.#range.from,
        0,
      ),
      source.length,
    );
    const head = draft?.head ?? codec.toShown(source, text, masterHead);
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(
        Math.min(Math.max(head, 0), text.length),
      ),
      effects: restorePairs.of(
        pairs ? slicePairs(this.controller.state, this.#range) : [],
      ),
      annotations: fromMaster.of(true),
    });
    if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) {
      this.view.focus();
    }
  }
}
