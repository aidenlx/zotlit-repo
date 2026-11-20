import type {
  DocumentSource,
  LegacyText,
  MountOptions,
  PdfEngine,
  PdfReader,
  ReaderEvents,
  ReaderState,
} from "#/core/index.ts";
import type { FixturePdf } from "#test/fixtures.ts";
import type { TestHost } from "#test/host.ts";

import { createPdfEngine, mountReader } from "#/core/index.ts";
import { testFetchData } from "#test/data.ts";
import { fixturePdf } from "#test/fixtures.ts";
import { testHost } from "#test/host.ts";

const readerCss = Object.values(
  import.meta.glob<string>("../src/generated/styles.css", {
    eager: true,
    query: "?raw",
    import: "default",
  }),
).join("\n");

export function installStyles(): void {
  const style = document.createElement("style");
  style.textContent = readerCss;
  document.head.append(style);
}

export function prependStyles(css: string): void {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.prepend(style);
}

export function addStyle(element: HTMLElement, declarations: string): void {
  element.style.cssText += declarations;
}

export async function importSource<T>(source: string): Promise<T> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  return (await import(url)) as T;
}

export function testEngine(idPrefix = "t"): PdfEngine {
  return createPdfEngine({ idPrefix, fetchData: testFetchData });
}

export async function forkItems(
  reader: PdfReader,
  pageIndex: number,
): Promise<readonly string[]> {
  const page = await reader.document.get()!.page(pageIndex);
  const content = await page!.getTextContent({
    includeMarkedContent: true,
    disableNormalization: true,
  });
  return content.items.flatMap((item) =>
    "str" in item && item.str !== undefined ? [item.str] : [],
  );
}

export function forkText(reader: () => PdfReader): LegacyText {
  return {
    items: (pageIndex) => forkItems(reader(), pageIndex),
    [Symbol.dispose]: () => {},
  };
}

export interface TestSource extends DocumentSource {
  readonly reads: number;
  change(): void;
}

export function fixtureSource(
  name: FixturePdf,
  options: { readonly gate?: Promise<void>; readonly onRead?: () => void } = {},
): TestSource {
  const listeners = new Set<() => void>();
  let reads = 0;
  return {
    key: name,
    name,
    get reads() {
      return reads;
    },
    read: async () => {
      reads++;
      options.onRead?.();
      await options.gate;
      return fixturePdf(name);
    },
    watch: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    change: () => {
      for (const listener of listeners) listener();
    },
  };
}

export interface Mounted extends Disposable {
  readonly reader: PdfReader;
  readonly host: TestHost;
  readonly element: HTMLElement;
}

export function mountFixture(
  engine: PdfEngine,
  options: Partial<MountOptions<null>> & {
    readonly source: DocumentSource;
    readonly host?: TestHost;
  },
): Mounted {
  const element = document.createElement("div");
  element.style.cssText = "position: relative; width: 760px; height: 540px;";
  document.body.append(element);
  const host = options.host ?? testHost();
  const reader = mountReader(element, {
    engine,
    host,
    hostContext: null,
    kind: "view",
    ...options,
  });
  return {
    reader,
    host,
    element,
    [Symbol.dispose]: () => {
      reader[Symbol.dispose]();
      element.remove();
    },
  };
}

export function nextEvent<K extends keyof ReaderEvents>(
  reader: PdfReader,
  event: K,
  accept: (payload: Parameters<ReaderEvents[K]>[0]) => boolean = () => true,
): Promise<Parameters<ReaderEvents[K]>[0]> {
  const { promise, resolve } =
    Promise.withResolvers<Parameters<ReaderEvents[K]>[0]>();
  const off = reader.on(event, (payload: Parameters<ReaderEvents[K]>[0]) => {
    if (!accept(payload)) return;
    off();
    resolve(payload);
  });
  return promise;
}

export function pause(milliseconds: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
}

export async function within<A>(
  label: string,
  promise: Promise<A>,
  milliseconds = 10_000,
): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not finish in ${milliseconds} ms`)),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function stateWhere(
  reader: PdfReader,
  accept: (state: ReaderState) => boolean,
): Promise<ReaderState> {
  const now = reader.state.get();
  if (accept(now)) return Promise.resolve(now);
  const { promise, resolve } = Promise.withResolvers<ReaderState>();
  const off = reader.state.subscribe((state) => {
    if (!accept(state)) return;
    off();
    resolve(state);
  });
  return promise;
}

export function part<E extends Element = HTMLElement>(
  reader: PdfReader,
  name: string,
): E {
  const element = reader.root.querySelector<E>(`[data-zpr-part="${name}"]`);
  if (!element) throw new Error(`The reader has no ${name} part`);
  return element;
}

export function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}
