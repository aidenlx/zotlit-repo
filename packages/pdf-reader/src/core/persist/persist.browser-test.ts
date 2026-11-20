import type { PdfEngine, PdfReader, ReaderState } from "#/core/index.ts";
import type { TestHost } from "#test/host.ts";

import { testHost } from "#test/host.ts";
import {
  fixtureSource,
  installStyles,
  mountFixture,
  pause,
  stateWhere,
  testEngine,
  within,
} from "#test/reader.ts";

type Kept = Pick<
  ReaderState,
  "pageIndex" | "spread" | "sidebar" | "zoom" | "themed"
>;

export interface PersistReport {
  readonly before: Kept & { readonly scale: number; readonly top: number };
  readonly reopened: Kept & {
    readonly rootThemed: boolean;
    readonly top: number;
  };
  readonly otherFile: Pick<ReaderState, "spread" | "sidebar" | "pageIndex">;
  readonly embed: Pick<ReaderState, "spread" | "pageIndex"> & {
    readonly sidebarOpen: boolean;
    readonly positionsAfter: number;
  };
  readonly stored: unknown;
}

function kept(state: ReaderState): Kept {
  return {
    pageIndex: state.pageIndex,
    spread: state.spread,
    sidebar: state.sidebar,
    zoom: state.zoom,
    themed: state.themed,
  };
}

function topEdge(reader: PdfReader, pageIndex: number): number {
  const page = reader.pageAt(pageIndex)!;
  const box = page.div.getBoundingClientRect();
  const edge = reader.container.getBoundingClientRect().top;
  const [, y = 0] = page.viewport.convertToPdfPoint(
    0,
    edge - box.top - page.div.clientTop,
  ) as number[];
  return y;
}

async function firstVisit(
  engine: PdfEngine,
  host: TestHost,
): Promise<PersistReport["before"]> {
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    host,
  });
  const { reader } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({
    spread: "odd",
    themed: true,
    sidebar: { open: true, panel: "outline", width: 220 },
  });
  reader.set({ zoom: 1.5 });
  await within(
    "zoom",
    stateWhere(reader, ({ scale }) => scale === 1.5),
  );
  await reader.navigate({ pageIndex: 4 });
  await within("settled", reader.settled());
  reader.container.scrollTop += 120;
  await within(
    "the scroll",
    stateWhere(reader, ({ pageIndex }) => pageIndex >= 4),
  );
  await pause(300);
  const state = reader.state.get();
  return {
    ...kept(state),
    scale: state.scale,
    top: topEdge(reader, state.pageIndex),
  };
}

export async function run(): Promise<PersistReport> {
  installStyles();
  using engine = testEngine();
  const host = testHost("navigation.pdf");
  const first = await firstVisit(engine, host);

  using again = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    host,
  });
  await within("ready", again.reader.whenReady());
  await within("settled", again.reader.settled());
  const reopenedState = again.reader.state.get();
  const reopened = {
    ...kept(reopenedState),
    rootThemed: again.reader.root.classList.contains("mod-themed"),
    top: topEdge(again.reader, reopenedState.pageIndex),
  };
  const stored = (host.storage.get("positions") as unknown[])[0];
  again[Symbol.dispose]();

  using other = mountFixture(engine, {
    source: fixtureSource("pdf-reader/chrome.pdf"),
    host,
  });
  await within("ready", other.reader.whenReady());
  const otherState = other.reader.state.get();

  const positionsBefore = (host.storage.get("positions") as unknown[]).length;
  using embed = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    host,
    kind: "embed",
  });
  await within("ready", embed.reader.whenReady());
  await within("settled", embed.reader.settled());
  embed.reader.container.scrollTop += 400;
  await pause(300);
  const embedState = embed.reader.state.get();
  const positions = host.storage.get("positions") as {
    readonly fingerprint: string;
  }[];

  return {
    before: first,
    reopened,
    otherFile: {
      spread: otherState.spread,
      sidebar: otherState.sidebar,
      pageIndex: otherState.pageIndex,
    },
    embed: {
      spread: embedState.spread,
      pageIndex: embedState.pageIndex,
      sidebarOpen: embedState.sidebar.open,
      positionsAfter: positions.length - positionsBefore,
    },
    stored,
  };
}
