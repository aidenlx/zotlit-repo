import type { FakeReader } from "#__fixtures__/pdf-annotation-editor.ts";
import type { App, EventRef, Workspace } from "obsidian";
import { Scope } from "obsidian";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { openNoteVault } from "@zotlit/plugin-services/obsidian/note-index/__fixtures__.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

import {
  annotationReads,
  attachmentReads,
  capabilityGestures,
  markGestures,
  pdfReader,
  readerDocument,
  readerSettings,
} from "#__fixtures__/pdf-annotation-editor.ts";
import { openPdfEditor } from "#__fixtures__/pdf-annotation-editor/editor.ts";

function pdfView(path: string, reader: FakeReader = pdfReader()) {
  return {
    file: { path },
    fake: reader,
    containerEl: document.createElement("div"),
    scope: new Scope(),
  };
}

function workspace() {
  const workspace: Workspace = stubService<Workspace>("Workspace", {
    getLeavesOfType: () => [],
    onLayoutReady: (callback: () => void) => callback(),
    on: () => stubService<EventRef>("EventRef", { e: workspace }),
    offref: () => {},
  });
  const app = stubService<App>("App", {
    workspace,
  });
  return app;
}

let noteIndexes = new AsyncDisposableStack();

async function emptyNoteIndex() {
  return (await openNoteVault({}, noteIndexes)).noteIndex.runtime.runSync(
    NoteIndex,
  );
}

async function readerRegistry(
  view: ReturnType<typeof pdfView>,
  { opened = true, os }: { opened?: boolean; os?: OperatingSystem } = {},
) {
  const service = await openPdfEditor({
    app: workspace(),
    os,
    attachments: attachmentReads(),
    annotations: annotationReads(),
    capabilityGestures: capabilityGestures(),
    markGestures: markGestures(),
    settings: readerSettings(),
    noteIndex: await emptyNoteIndex(),
  });
  service.attach(view, { opened });
  return service;
}

beforeEach(() => {
  setMockPlatform({ isMacOS: false });
});

afterEach(async () => {
  resetMockPlatform();
  await noteIndexes.disposeAsync();
  noteIndexes = new AsyncDisposableStack();
});

it("answers nothing for a file no open view holds", async () => {
  await using service = await readerRegistry(pdfView("paper.pdf"));

  expect(service.borrowDocument("/vault/other.pdf")).toBeNull();
  expect(service.borrowDocument("/vault")).toBeNull();
});

it("matches a path in another letter case only where the system folds case", async () => {
  await using folding = await readerRegistry(pdfView("paper.pdf"), {
    os: "darwin",
  });
  await using exact = await readerRegistry(pdfView("paper.pdf"), {
    os: "linux",
  });

  expect(folding.borrowDocument("/vault/Paper.PDF")).not.toBeNull();
  expect(exact.borrowDocument("/vault/Paper.PDF")).toBeNull();
  expect(exact.borrowDocument("/vault/paper.pdf")).not.toBeNull();
});

it("answers nothing while the reader has not opened its document", async () => {
  await using service = await readerRegistry(pdfView("paper.pdf"), {
    opened: false,
  });

  expect(service.borrowDocument("/vault/paper.pdf")).toBeNull();
});

it("withdraws a lent document when the reader closes it", async () => {
  const reader = pdfReader();
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  const borrowed = service.borrowDocument("/vault/paper.pdf");
  expect(borrowed).not.toBeNull();

  reader.closeDocument();

  expect(service.borrowDocument("/vault/paper.pdf")).toBeNull();
  expect(await borrowed!.page(0)).toBeNull();
});

it("withdraws a lent document when the reader replaces it", async () => {
  const reader = pdfReader();
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  const borrowed = service.borrowDocument("/vault/paper.pdf");

  const replacement = readerDocument(reader.page);
  reader.reloadDocument(replacement);

  expect(await borrowed!.page(0)).toBeNull();
  const next = service.borrowDocument("/vault/paper.pdf");
  expect(next?.document).toBe(replacement.document.proxy);
  expect(await next?.page(0)).toBe(reader.page.pdfPage);
});

it("answers no bytes for a document whose read fails", async () => {
  const reader = pdfReader();
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  vi.spyOn(reader.document!, "bytes").mockRejectedValueOnce(
    new Error("Worker was destroyed"),
  );

  const borrowed = service.borrowDocument("/vault/paper.pdf");

  expect(borrowed).not.toBeNull();
  expect(await borrowed?.bytes()).toBeNull();
});

it("answers no page for a document that cannot read one", async () => {
  const reader = pdfReader();
  await using service = await readerRegistry(pdfView("paper.pdf", reader));
  vi.spyOn(reader.document!, "page").mockRejectedValueOnce(
    new Error("Worker was destroyed"),
  );

  const borrowed = service.borrowDocument("/vault/paper.pdf");

  expect(await borrowed?.page(0)).toBeNull();
});
