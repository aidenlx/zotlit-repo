import type { ReaderDocument } from "#/core/document/document.ts";
import type { LegacyText, ReaderHost } from "#/core/host.ts";
import type { PageView } from "#/core/viewer/viewer.ts";

export type TextRange = readonly [number, number, number, number];

const SPACE = /\s/;
const SPACES = /\s/g;

interface Layout {
  readonly items: readonly string[];
  readonly starts: readonly number[];
  readonly text: string;
}

function layoutOf(items: readonly string[]): Layout {
  const starts: number[] = [];
  let at = 0;
  for (const item of items) {
    starts.push(at);
    at += item.length;
  }
  return { items, starts, text: items.join("") };
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && SPACE.test(char);
}

function align(from: string, to: string): Int32Array {
  const map = new Int32Array(from.length + 1);
  let x = 0;
  let y = 0;
  while (x < from.length) {
    if (y < to.length && from[x] === to[y]) {
      map[x++] = y++;
    } else if (y < to.length && !isSpace(from[x]) && isSpace(to[y])) {
      y++;
    } else {
      map[x++] = y;
    }
  }
  map[from.length] = to.length;
  return map;
}

function textOffset(
  layout: Layout,
  item: number,
  offset: number,
): number | null {
  const text = layout.items[item];
  if (text === undefined) return null;
  return layout.starts[item]! + Math.min(Math.max(offset, 0), text.length);
}

function startPoint(layout: Layout, at: number): [number, number] | null {
  for (let item = 0; item < layout.items.length; item++) {
    const length = layout.items[item]!.length;
    const start = layout.starts[item]!;
    if (length > 0 && at < start + length)
      return [item, Math.max(at - start, 0)];
  }
  return null;
}

function endPoint(layout: Layout, at: number): [number, number] | null {
  for (let item = layout.items.length - 1; item >= 0; item--) {
    const length = layout.items[item]!.length;
    const start = layout.starts[item]!;
    if (length > 0 && at > start) return [item, Math.min(at - start, length)];
  }
  return null;
}

function mapTextRange(
  from: readonly string[],
  to: readonly string[],
  range: TextRange,
): TextRange | null {
  const source = layoutOf(from);
  const target = layoutOf(to);
  if (source.text.replaceAll(SPACES, "") !== target.text.replaceAll(SPACES, ""))
    return null;
  const start = textOffset(source, range[0], range[1]);
  const end = textOffset(source, range[2], range[3]);
  if (start === null || end === null) return null;
  let first = start;
  let last = end - 1;
  while (first <= last && isSpace(source.text[first])) first++;
  while (last >= first && isSpace(source.text[last])) last--;
  if (first > last) return null;
  const map = align(source.text, target.text);
  const head = startPoint(target, map[first]!);
  const tail = endPoint(target, map[last]! + 1);
  return head && tail ? [...head, ...tail] : null;
}

function forkItems(view: PageView): readonly string[] {
  return view._textHighlighter.textContentItemsStr ?? [];
}

export class SelectionLinks implements Disposable {
  readonly #host: ReaderHost;
  readonly #document: ReaderDocument;
  readonly #password: string | undefined;
  readonly #loaded = new Map<number, readonly string[] | null>();
  #source: LegacyText | null = null;
  #disposed = false;

  constructor(
    host: ReaderHost,
    document: ReaderDocument,
    password: string | undefined,
  ) {
    this.#host = host;
    this.#document = document;
    this.#password = password;
  }

  async linkRange(view: PageView, range: TextRange): Promise<TextRange | null> {
    const items = await this.#items(view.id - 1);
    return items && mapTextRange(forkItems(view), items, range);
  }

  async load(pageIndex: number): Promise<void> {
    this.#loaded.delete(pageIndex);
    this.#loaded.set(pageIndex, await this.#items(pageIndex));
  }

  loaded(pageIndex: number): boolean {
    return this.#loaded.has(pageIndex);
  }

  forkRange(view: PageView, range: TextRange): TextRange | null {
    const items = this.#loaded.get(view.id - 1);
    return items ? mapTextRange(items, forkItems(view), range) : null;
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#source?.[Symbol.dispose]();
  }

  async #items(pageIndex: number): Promise<readonly string[] | null> {
    if (!this.#host.legacyText || this.#disposed) return null;
    this.#source ??= this.#host.legacyText({
      password: this.#password,
      bytes: () => this.#document.bytes(),
    });
    try {
      return await this.#source.items(pageIndex);
    } catch (error) {
      if (!this.#disposed) {
        this.#host.report(error, { phase: "legacy-selection" });
      }
      return null;
    }
  }
}
