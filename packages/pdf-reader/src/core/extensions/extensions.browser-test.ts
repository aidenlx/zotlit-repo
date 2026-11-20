import type {
  NavigateOutcome,
  PdfEngine,
  PdfReader,
  ReaderExtension,
  ReaderState,
} from "#/core/index.ts";
import type { FixturePdf } from "#test/fixtures.ts";

import { buildPdf, bytesSource } from "#test/pdf.ts";
import {
  fixtureSource,
  installStyles,
  mountFixture,
  pause,
  testEngine,
  within,
} from "#test/reader.ts";

const BROKEN_PAGE = buildPdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "42",
]);

export interface ExtensionsReport {
  readonly fence: {
    readonly reports: readonly {
      readonly extension?: string;
      readonly phase: string;
    }[];
    readonly draws: number;
    readonly listenerCalls: number;
    readonly subscriberCalls: number;
    readonly embedOnly: number;
    readonly order: readonly string[];
  };
  readonly status: Readonly<Record<string, Status>>;
  readonly live: {
    readonly attached: readonly {
      readonly subpath: string | null;
      readonly document: boolean;
      readonly rendered: boolean;
    }[];
    readonly reports: readonly {
      readonly extension?: string;
      readonly phase: string;
    }[];
    readonly embedOnly: number;
    readonly whileLive: Nodes;
    readonly removed: Nodes;
    readonly disposedOnRemove: number;
    readonly drawsAfterRemove: number;
    readonly mountedStillDraws: boolean;
  };
  readonly disposed: {
    readonly settled: string;
    readonly navigate: NavigateOutcome;
    readonly ready: string;
    readonly instanceDisposed: number;
    readonly statusAfter: ReaderState["status"];
    readonly rootAttached: boolean;
  };
}

interface Nodes {
  readonly slot: number;
  readonly drawn: number;
  readonly marks: number;
}

interface Status {
  readonly order: readonly string[];
  readonly atAttach: {
    readonly status: ReaderState["status"];
    readonly document: boolean;
    readonly rendered: number;
  };
  readonly final: Pick<ReaderState, "status" | "failure" | "passwordRetry">;
  readonly queued: NavigateOutcome | "pending";
  readonly document: boolean;
  readonly disposed: number;
  readonly ready: "null" | "document" | "pending";
  readonly settled: boolean;
}

function until(
  reader: PdfReader,
  accept: (state: ReaderState) => boolean,
): Promise<ReaderState> {
  const { promise, resolve } = Promise.withResolvers<ReaderState>();
  if (accept(reader.state.get())) resolve(reader.state.get());
  const stop = reader.state.subscribe((state) => {
    if (!accept(state)) return;
    stop();
    resolve(state);
  });
  return promise;
}

async function fence(engine: PdfEngine): Promise<ExtensionsReport["fence"]> {
  let draws = 0;
  let listenerCalls = 0;
  let subscriberCalls = 0;
  let embedOnly = 0;
  const order: string[] = [];
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    extensions: [
      {
        id: "broken",
        attach: () => {
          order.push("broken");
          throw new Error("attach fails");
        },
        drawPage: () => {
          draws += 1000;
        },
      },
      {
        id: "listener",
        attach: ({ reader }) => {
          order.push("listener");
          reader.on("page-rendered", () => {
            listenerCalls++;
            throw new Error("listener fails");
          });
        },
      },
      {
        id: "subscriber",
        attach: ({ reader }) => {
          reader.state.subscribe(() => {
            subscriberCalls++;
            throw new Error("subscriber fails");
          });
        },
      },
      {
        id: "embed-only",
        kinds: ["embed"],
        attach: () => {
          embedOnly++;
        },
      },
      {
        id: "after",
        attach: () => {
          order.push("after");
        },
        drawPage: () => {
          draws++;
        },
      },
    ],
  });
  const { reader, host } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  reader.set({ zoom: 1.5 });
  await within("settled after zoom", reader.settled());
  return {
    reports: host.reports.map(({ extension, phase }) => ({ extension, phase })),
    draws,
    listenerCalls,
    subscriberCalls,
    embedOnly,
    order,
  };
}

function nodes(reader: PdfReader): Nodes {
  const count = (selector: string) =>
    reader.root.querySelectorAll(selector).length;
  return {
    slot: count('[data-zpr-slot="toolbar-end"] [data-probe="late-button"]'),
    drawn: count('[data-zpr-layer="late"]'),
    marks: count('[data-zpr-layer="late-marks"]'),
  };
}

async function live(engine: PdfEngine): Promise<ExtensionsReport["live"]> {
  let mountedDraws = 0;
  using mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf"),
    subpath: "#page=2",
    extensions: [
      {
        id: "mounted",
        drawPage: () => {
          mountedDraws++;
        },
      },
    ],
  });
  const { reader, extensions, host } = mounted;
  await within("ready", reader.whenReady());
  await within("settled", reader.settled());
  const attached: ExtensionsReport["live"]["attached"][number][] = [];
  let embedOnly = 0;
  let draws = 0;
  let disposedOnRemove = 0;
  extensions.add(
    {
      id: "late-broken",
      attach: () => {
        throw new Error("late attach fails");
      },
    },
    { host: null, subpath: null },
  );
  const lateExtension: ReaderExtension<null> = {
    id: "late",
    attach: ({ reader: late, subpath }) => {
      attached.push({
        subpath: subpath?.raw ?? null,
        document: late.document.get() !== null,
        rendered: late.renderedPages().length > 0,
      });
      const button = document.createElement("button");
      button.dataset.probe = "late-button";
      late.slot("toolbar-end").append(button);
      for (const page of late.renderedPages()) page.layer("late-marks");
      return {
        [Symbol.dispose]: () => {
          disposedOnRemove++;
        },
      };
    },
    drawPage: (_page, layer) => {
      draws++;
      layer.textContent = "late";
    },
  };
  extensions.add(lateExtension, { host: null, subpath: null });
  extensions.add(
    {
      id: "embed-only",
      kinds: ["embed"],
      attach: () => {
        embedOnly++;
      },
    },
    { host: null, subpath: null },
  );
  reader.set({ zoom: 1.5 });
  await within("settled after zoom", reader.settled());
  const whileLive = nodes(reader);
  extensions.remove(lateExtension);
  const drawsAtRemove = draws;
  const mountedAtRemove = mountedDraws;
  reader.set({ zoom: 1 });
  await within("settled after removal", reader.settled());
  return {
    attached,
    reports: host.reports.map(({ extension, phase }) => ({ extension, phase })),
    embedOnly,
    whileLive,
    removed: nodes(reader),
    disposedOnRemove,
    drawsAfterRemove: draws - drawsAtRemove,
    mountedStillDraws: mountedDraws > mountedAtRemove,
  };
}

async function status(
  engine: PdfEngine,
  name: FixturePdf | "broken-page.pdf",
): Promise<Status> {
  const order: string[] = [];
  let atAttach: Status["atAttach"] | null = null;
  let disposed = 0;
  const onRead = () => order.push("read");
  using mounted = mountFixture(engine, {
    source:
      name === "broken-page.pdf"
        ? bytesSource(name, BROKEN_PAGE, onRead)
        : fixtureSource(name, { onRead }),
    extensions: [
      {
        id: "status",
        attach: ({ reader }) => {
          order.push("attach");
          atAttach = {
            status: reader.state.get().status,
            document: reader.document.get() !== null,
            rendered: reader.renderedPages().length,
          };
          return {
            [Symbol.dispose]: () => {
              disposed++;
            },
          };
        },
      },
    ],
  });
  const { reader } = mounted;
  const queued = reader.navigate({ pageIndex: 1 });
  const final = await within(
    `${name} settles`,
    until(
      reader,
      (state) => state.status === "password" || state.status === "failed",
    ),
  );
  return {
    order,
    atAttach: atAttach!,
    final: {
      status: final.status,
      failure: final.failure,
      passwordRetry: final.passwordRetry,
    },
    queued:
      final.status === "failed"
        ? await within(`${name} queued navigate`, queued)
        : "pending",
    document: reader.document.get() !== null,
    disposed,
    ready: await Promise.race([
      reader
        .whenReady()
        .then((document) => (document === null ? "null" : "document")),
      pause(2000).then(() => "pending" as const),
    ]),
    settled: await Promise.race([
      reader.settled().then(() => true),
      pause(2000).then(() => false),
    ]),
  };
}

async function disposed(
  engine: PdfEngine,
): Promise<ExtensionsReport["disposed"]> {
  const gate = Promise.withResolvers<void>();
  let instanceDisposed = 0;
  const mounted = mountFixture(engine, {
    source: fixtureSource("pdf-reader/navigation.pdf", { gate: gate.promise }),
    extensions: [
      {
        id: "lifetime",
        attach: () => ({
          [Symbol.dispose]: () => {
            instanceDisposed++;
          },
        }),
      },
    ],
  });
  const { reader } = mounted;
  const settled = reader.settled().then(
    () => "resolved",
    (error: unknown) =>
      error instanceof DOMException ? error.name : String(error),
  );
  const ready = reader
    .whenReady()
    .then((document) => (document === null ? "null" : "document"));
  const navigate = reader.navigate("#page=2");
  mounted[Symbol.dispose]();
  gate.resolve();
  return {
    settled: await within("settled after dispose", settled),
    navigate: await within("navigate after dispose", navigate),
    ready: await within("ready after dispose", ready),
    instanceDisposed,
    statusAfter: reader.state.get().status,
    rootAttached: reader.root.isConnected,
  };
}

export async function run(): Promise<ExtensionsReport> {
  installStyles();
  using engine = testEngine();
  return {
    fence: await fence(engine),
    status: {
      encrypted: await status(engine, "excerpt-rendering/encrypted.pdf"),
      corrupt: await status(engine, "excerpt-rendering/corrupt.pdf"),
      brokenPage: await status(engine, "broken-page.pdf"),
    },
    live: await live(engine),
    disposed: await disposed(engine),
  };
}
