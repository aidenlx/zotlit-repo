import { Events } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReaderApi, RefuseReason } from "./index.ts";
import { answerConnect, connectReader, READER_API } from "./index.ts";

function readerApi(major: number, minor: number): ReaderApi {
  return {
    api: { major, minor },
    readerVersion: "1.2.0",
    pdfjsBuild: "fork-build",
    viewType: "zotlit-pdf",
    addExtension: () => () => {},
    open: async () => "opened",
    readerOf: () => null,
    loadDocument: () => Promise.reject(new Error("not loaded in this test")),
    onClose: () => () => {},
  };
}

type Answer =
  | { readonly kind: "accept"; readonly api: ReaderApi }
  | { readonly kind: "refuse"; readonly reason: RefuseReason }
  | { readonly kind: "absent" };

function client(
  workspace: Events,
  version: { readonly major: number; readonly minor: number } = READER_API,
) {
  const answers: Answer[] = [];
  const disconnect = connectReader(
    workspace,
    { client: "zotlit", ...version },
    {
      onAccept: (api) => answers.push({ kind: "accept", api }),
      onRefuse: (reason) => answers.push({ kind: "refuse", reason }),
      onAbsent: () => answers.push({ kind: "absent" }),
    },
  );
  return { answers, disconnect };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the handshake between a client and ZotLit Reader", () => {
  it("accepts in the same call when the Reader loaded first", () => {
    const workspace = new Events();
    const api = readerApi(1, 0);
    answerConnect(workspace, new Map([[1, api]]));

    const { answers } = client(workspace);

    expect(answers).toEqual([{ kind: "accept", api }]);
  });

  it("reports absent, then accepts once the Reader announces it is ready", () => {
    const workspace = new Events();
    const api = readerApi(1, 0);
    const { answers } = client(workspace);

    expect(answers).toEqual([{ kind: "absent" }]);

    answerConnect(workspace, new Map([[1, api]]));

    expect(answers).toEqual([{ kind: "absent" }, { kind: "accept", api }]);
  });

  it("gives each client the adapter of the major it asks for", () => {
    const workspace = new Events();
    const previous = readerApi(1, 3);
    const current = readerApi(2, 0);
    answerConnect(
      workspace,
      new Map([
        [1, previous],
        [2, current],
      ]),
    );

    expect(client(workspace, { major: 1, minor: 2 }).answers).toEqual([
      { kind: "accept", api: previous },
    ]);
    expect(client(workspace, { major: 2, minor: 0 }).answers).toEqual([
      { kind: "accept", api: current },
    ]);
  });

  it("refuses a major the Reader does not support", () => {
    const workspace = new Events();
    answerConnect(workspace, new Map([[1, readerApi(1, 0)]]));

    const { answers } = client(workspace, { major: 2, minor: 0 });

    expect(answers).toEqual([
      { kind: "refuse", reason: { supported: [1], readerVersion: "1.2.0" } },
    ]);
  });

  it("refuses a Reader whose minor is lower than the client needs", () => {
    const workspace = new Events();
    answerConnect(workspace, new Map([[1, readerApi(1, 0)]]));

    const { answers } = client(workspace, { major: 1, minor: 1 });

    expect(answers).toEqual([
      { kind: "refuse", reason: { supported: [1], readerVersion: "1.2.0" } },
    ]);
  });

  it("stops connecting after the client unsubscribes", () => {
    const workspace = new Events();
    const { answers, disconnect } = client(workspace);
    disconnect();

    answerConnect(workspace, new Map([[1, readerApi(1, 0)]]));

    expect(answers).toEqual([{ kind: "absent" }]);
  });

  it("stops answering after the Reader unsubscribes", () => {
    const workspace = new Events();
    const stopAnswering = answerConnect(
      workspace,
      new Map([[1, readerApi(1, 0)]]),
    );
    stopAnswering();

    expect(client(workspace).answers).toEqual([{ kind: "absent" }]);
  });

  it("keeps the Reader answering when a client's listener throws", () => {
    vi.useFakeTimers();
    const workspace = new Events();
    const failure = new Error("the client failed on accept");
    connectReader(
      workspace,
      { client: "failing", ...READER_API },
      {
        onAccept: () => {
          throw failure;
        },
        onRefuse: () => {},
        onAbsent: () => {},
      },
    );
    const api = readerApi(1, 0);

    answerConnect(workspace, new Map([[1, api]]));

    expect(client(workspace).answers).toEqual([{ kind: "accept", api }]);
    expect(() => vi.runAllTimers()).toThrow(failure);
  });
});
