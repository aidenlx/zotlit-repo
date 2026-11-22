import type {
  FilterSection,
  QueryFile,
  QueryFileDataset,
  QueryFileView,
  QueryFileViewEdit,
} from "#core/query-view/query-file.ts";
import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { MatchTree } from "@zotlit/templates/facade";

import * as edits from "./view-edits.ts";
import { viewProperties } from "./view-properties.ts";
import type { QueryViewHost } from "./view.tsx";

import {
  editView,
  formulaProperty,
  parseQueryFile,
  removeFormula,
  serializeQueryFile,
  withDisplayName,
  withFilters,
  withFormula,
} from "#core/query-view/query-file.ts";

export type DocumentHost = Pick<
  QueryViewHost,
  "save" | "canSave" | "onSelectView"
>;

export interface DocumentEvents {
  show: () => void;
  saveFailed: (failed: boolean) => void;
  win: () => Window;
}

export const SAVE_DELAY_MS = 500;

export interface EditTiming {
  typed?: boolean;
}

export class QueryFileDocument {
  readonly #host: DocumentHost;
  readonly #events: DocumentEvents;
  #text: string | null = null;
  #file: QueryFile | null = null;
  #wanted: string | null = null;
  #shown = -1;
  #typedSave: { text: string; timer: number; win: Window } | null = null;
  #writing: Promise<void> = Promise.resolve();
  #pending = 0;
  #saves = 0;

  constructor(host: DocumentHost, events: DocumentEvents) {
    this.#host = host;
    this.#events = events;
  }

  get text(): string | null {
    return this.#text;
  }

  get file(): QueryFile | null {
    return this.#file;
  }

  get view(): QueryFileView | null {
    return this.#file?.views[this.#shown] ?? null;
  }

  get wanted(): string | null {
    return this.#wanted;
  }

  setText(text: string): boolean {
    if (text === this.#text) return false;
    this.#text = text;
    this.#file = parseQueryFile(text);
    this.#choose();
    return true;
  }

  selectView(name: string | null): void {
    if (name === this.#wanted && this.view?.name === name) return;
    this.#wanted = name;
    this.#choose();
  }

  clear(): void {
    this.#text = null;
    this.#file = null;
  }

  get viewName(): string | null {
    return this.view?.name ?? this.#wanted;
  }

  pickView(name: string): void {
    this.selectView(name);
    this.#host.onSelectView?.(name);
  }

  get canSave(): boolean {
    return this.#host.canSave?.() ?? true;
  }

  editView(edit: QueryFileViewEdit, timing: EditTiming = {}): void {
    const { file, view } = this;
    if (!file || !view) return;
    this.#commit(editView(file, view, edit), this.#shown, timing);
  }

  setFilters(section: FilterSection, filters: MatchTree | undefined): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    const index = section === "all" ? null : this.#shown;
    this.#commit(withFilters(file, index, filters), this.#shown);
    return true;
  }

  renameProperty(property: string, name: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    this.#commit(
      withDisplayName(file, property, name.trim() || undefined),
      this.#shown,
    );
    return true;
  }

  saveFormula(name: string, text: string, label?: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    let next = withFormula(file, name, text);
    const property = formulaProperty(name);
    if (label !== undefined)
      next = withDisplayName(next, property, label.trim() || undefined);
    if (!Object.hasOwn(file.formulas ?? {}, name)) {
      const properties = viewProperties(file, view);
      const shown = properties.visible.map((entry) => entry.path);
      if (!shown.includes(property))
        next = editView(next, view, {
          order: properties.orderOf([...shown, property]),
        });
    }
    this.#commit(next, this.#shown);
    return true;
  }

  removeFormula(name: string): boolean {
    const { file, view } = this;
    if (!file || !view) return false;
    this.#commit(removeFormula(file, name), this.#shown);
    return true;
  }

  addView(base: string = m.query_view_new_view_name()): string {
    const file = this.#file;
    if (!file) return base;
    const edit = edits.addView(file, base, this.view?.from ?? "annotations");
    this.#commit(edit.file, file.views.length);
    return edit.name;
  }

  renameView(index: number, name: string): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.renameView(file, index, name), this.#shown, {
      typed: true,
    });
  }

  duplicateView(index: number): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.duplicateView(file, index).file, index + 1);
  }

  deleteView(index: number): void {
    const file = this.#file;
    if (!file || file.views.length <= 1) return;
    const shown = this.#shown;
    this.#commit(
      edits.deleteView(file, index).file,
      shown === index
        ? Math.max(0, index - 1)
        : shown > index
          ? shown - 1
          : shown,
    );
  }

  moveView(from: number, to: number): void {
    const file = this.#file;
    if (!file || from === to) return;
    const shown = this.#shown;
    this.#commit(
      edits.moveView(file, from, to),
      shown === from
        ? to
        : from < shown && to >= shown
          ? shown - 1
          : from > shown && to <= shown
            ? shown + 1
            : shown,
    );
  }

  setViewOption(index: number, key: string, value: unknown): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewOption(file, index, { key, value }), this.#shown);
  }

  setViewLayout(index: number, type: string): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewLayout(file, index, type), this.#shown);
  }

  setViewDataset(index: number, dataset: QueryFileDataset): void {
    const file = this.#file;
    if (!file) return;
    this.#commit(edits.setViewDataset(file, index, dataset), this.#shown);
  }

  flush(): Promise<void> {
    const typed = this.#typedSave;
    this.#cancelTypedSave();
    if (typed) this.#save(typed.text);
    return this.#writing;
  }

  #commit(next: QueryFile, place: number, { typed }: EditTiming = {}): void {
    const text = serializeQueryFile(next);
    const before = this.view?.name ?? null;
    const file = parseQueryFile(text);
    this.#text = text;
    this.#file = file;
    const view = file.views[place];
    if (view) {
      if (placeOf(file, this.#wanted, place) !== place)
        this.#wanted = view.name;
      this.#shown = place;
      this.#events.show();
      if (view.name !== before) this.#host.onSelectView?.(view.name);
    } else this.#choose();
    this.#cancelTypedSave();
    if (typed) {
      const win = this.#events.win();
      const timer = win.setTimeout(() => {
        this.#typedSave = null;
        this.#save(text);
      }, SAVE_DELAY_MS);
      this.#typedSave = { text, timer, win };
    } else this.#save(text);
  }

  #cancelTypedSave(): void {
    if (this.#typedSave)
      this.#typedSave.win.clearTimeout(this.#typedSave.timer);
    this.#typedSave = null;
  }

  #save(text: string): void {
    if (!this.canSave) return;
    const save = ++this.#saves;
    const write = async () => {
      let failed = false;
      try {
        await this.#host.save(text);
      } catch (error) {
        failed = true;
        Effect.runSyncWith(logServices)(
          Effect.logWarning("A Query View could not save its file").pipe(
            Effect.annotateLogs({ error }),
            withLogCategory("views", "query-view"),
          ),
        );
      }
      this.#pending--;
      if (save === this.#saves) this.#events.saveFailed(failed);
    };
    this.#writing = this.#pending++ === 0 ? write() : this.#writing.then(write);
  }

  #choose(): void {
    if (!this.#file) return;
    this.#shown = placeOf(this.#file, this.#wanted, this.#shown);
    this.#events.show();
  }
}

function placeOf(
  file: QueryFile,
  wanted: string | null,
  prefer: number,
): number {
  if (wanted === null) return file.views.length > 0 ? 0 : -1;
  if (file.views[prefer]?.name === wanted) return prefer;
  return file.views.findIndex((view) => view.name === wanted);
}
