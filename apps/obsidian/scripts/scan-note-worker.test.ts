import { Worker } from "node:worker_threads";
import { expect, it, vi } from "vitest";

import type { ParseReply } from "@zotlit/citations/core/citation-parse/client.ts";

import { scanBenchmarkWorker } from "./scan-benchmark-worker.ts";

it("runs the production parse worker without Obsidian", async ({
  annotate,
}) => {
  await annotate("https://github.com/aidenlx/zotlit-repo/issues/98", "issue");
  await using worker = await scanBenchmarkWorker<{
    path: string;
    generation: number;
    record: unknown;
  }>();
  const signal = new AbortController().signal;
  await expect(
    worker.parse({ path: "throwing.md", generation: 11, text: null! }, signal),
  ).rejects.toThrow();
  const reply = await worker.parse(
    {
      path: "draft.md",
      generation: 12,
      text: "[](zotero://open/groups/42/items/ABCD2345?annotation=EFGH6789)",
    },
    signal,
  );
  expect(worker.workerMs).toBeGreaterThan(0);
  expect(worker.postMs).toBeGreaterThan(0);
  expect([reply]).toEqual([
    {
      path: "draft.md",
      generation: 12,
      record: {
        ranges: [],
        links: [],
        citations: [],
        citekeys: [],
        wikilinks: [],
        malformedWikilinks: [],
        malformedAnnotationCitations: [],
        annotations: [
          {
            form: "citation",
            text: "",
            indexedKey: "EFGH6789g42",
            attachmentKey: "ABCD2345",
            pageLabel: null,
            position: {
              start: { line: 0, col: 0, offset: 0 },
              end: { line: 0, col: 62, offset: 62 },
            },
          },
        ],
      },
    },
  ]);
});

it("keeps every index occurrence and its position in an index-only reply", async ({
  annotate,
}) => {
  await annotate("https://github.com/aidenlx/zotlit-repo/issues/181", "issue");
  await using worker = await scanBenchmarkWorker<ParseReply>();
  const text = [
    "%% [@hidden] %%",
    "[@work]",
    "[[Note#cite:locator=4]]",
    "[[Note#cite:]]",
    "[file](paper.pdf)",
    "[](zotero://open/library/items/ABCD2345?annotation=EFGH6789)",
    "[](zotero://open/library/items/ABCD2345)",
  ].join("\n");
  const request = { path: "draft.md", generation: 1, text };
  const signal = new AbortController().signal;
  const position = (
    line: number,
    offset: number,
    [from, to]: [number, number],
  ) => ({
    start: { line, col: from, offset: offset + from },
    end: { line, col: to, offset: offset + to },
  });
  const occurrences = {
    citekeys: [
      { kind: "citekey", raw: "work", position: position(1, 16, [1, 6]) },
    ],
    wikilinks: [
      {
        kind: "wikilink",
        raw: "Note",
        fragment: "locator=4",
        position: position(2, 24, [0, 23]),
      },
    ],
    malformedWikilinks: [
      {
        occurrence: {
          kind: "wikilink",
          raw: "Note",
          position: position(3, 48, [0, 14]),
        },
      },
    ],
    annotations: [
      {
        form: "citation",
        text: "",
        indexedKey: "EFGH6789",
        attachmentKey: "ABCD2345",
        pageLabel: null,
        position: position(5, 81, [0, 60]),
      },
    ],
    malformedAnnotationCitations: [
      {
        destination: "zotero://open/library/items/ABCD2345",
        position: position(6, 142, [0, 40]),
      },
    ],
  };
  const indexed = await worker.parse({ ...request, indexOnly: true }, signal);
  expect(indexed).toEqual({
    path: request.path,
    generation: request.generation,
    record: { ...occurrences, ranges: [], links: [], citations: [] },
  });
  const full = await worker.parse(request, signal);
  expect(full.record).toMatchObject({
    ...occurrences,
    ranges: [{ kind: "comment", from: 0, to: 15 }],
    links: [
      {
        kind: "wikilink",
        embedded: false,
        target: "Note#cite:locator=4",
        position: position(2, 24, [0, 23]),
      },
      {
        kind: "wikilink",
        embedded: false,
        target: "Note#cite:",
        position: position(3, 48, [0, 14]),
      },
      {
        kind: "link",
        embedded: false,
        target: "paper.pdf",
        position: position(4, 63, [0, 17]),
      },
    ],
    citations: [
      { start: 16, end: 23, keys: [{ citekey: "work", start: 17, end: 22 }] },
    ],
  });
});

it("includes codec and postMessage time in the measured posting cost", async () => {
  await using worker = await scanBenchmarkWorker();
  const request = { path: "draft.md", generation: 1, text: "" };
  const signal = new AbortController().signal;
  await worker.parse(request, signal);
  using stack = new DisposableStack();
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now++);
  stack.defer(() => clock.mockRestore());
  // oxlint-disable-next-line typescript/unbound-method -- The spy calls this method with its original worker receiver below.
  const post = Worker.prototype.postMessage;
  const posting = vi.spyOn(Worker.prototype, "postMessage");
  posting.mockImplementation(function (this: Worker, value, transfers) {
    now += 100;
    post.call(this, value, transfers);
  });
  stack.defer(() => posting.mockRestore());
  await worker.parse(request, signal);
  expect(worker.postMs).toBeGreaterThanOrEqual(102);
});
