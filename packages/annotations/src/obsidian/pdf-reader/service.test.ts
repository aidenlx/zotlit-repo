import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import type { App, ViewState } from "obsidian";
import { TFile, WorkspaceLeaf } from "obsidian";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { resolverFixture } from "@zotlit/plugin-services/obsidian/attachment-resolver/__fixtures__.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { ConnectHandlers, ReaderApi } from "@zotlit/reader-api";

import { layerZotlitPdfReader } from "./service.ts";

import { OPENER_ROWS, VAULT } from "#__fixtures__/attachment-open.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

const READER = "zotlit-pdf";
const ZOTERO_PDF = "attachments/rougier-2014.pdf";
const OTHER_PDF = "pdf-reader-theme.pdf";

let native: MockInstance<WorkspaceLeaf["setViewState"]>;

beforeEach(() => {
  native = vi.spyOn(WorkspaceLeaf.prototype, "setViewState");
});
afterEach(() => {
  vi.restoreAllMocks();
});

const fileAt = (path: string): TFile =>
  Object.assign(new TFile(), { path, extension: "pdf" });

const readerOver = Effect.fnUntraced(function* (prime: boolean) {
  const harness = yield* resolverFixture({
    rows: OPENER_ROWS,
    vaultDir: VAULT,
    prime,
  });
  let handlers: ConnectHandlers | null = null;
  const scope = yield* Scope.make();
  yield* Layer.build(
    layerZotlitPdfReader.pipe(
      Layer.provideMerge(
        layerReaderConnection((next) => {
          handlers = next;
          return () => {
            handlers = null;
          };
        }),
      ),
      Layer.provideMerge(layerWorkspaceFrom(new MemoryWorkspace())),
      Layer.provideMerge(layerDeviceStorageFrom(new MemoryDeviceStorage())),
      Layer.provideMerge(testNotifier().layer),
      Layer.provideMerge(
        Layer.succeed(
          ObsidianApp,
          stubService<App>("App", {
            plugins: stubService<App["plugins"]>("App.plugins", {
              plugins: {},
              manifests: {},
            }),
          }),
        ),
      ),
      Layer.provideMerge(Layer.succeed(AttachmentResolver, harness.service)),
      Layer.provideMerge(
        Layer.mock(Vault, {
          getFileByPath: (path) => Effect.succeed(fileAt(path)),
        }),
      ),
    ),
  ).pipe(Effect.provideService(Scope.Scope, scope));
  const connect = Effect.fnUntraced(function* () {
    handlers!.onAccept(
      stubService<ReaderApi>("ReaderApi", {
        viewType: READER,
        onClose: () => () => {},
      }),
    );
    yield* Effect.yieldNow;
  });
  return { connect, close: Scope.close(scope, Exit.void) };
});

const shownAs = (file: string) =>
  Effect.promise(async () => {
    await new WorkspaceLeaf().setViewState({
      type: "pdf",
      state: { file },
    } satisfies ViewState);
    return native.mock.calls.at(-1)?.[0].type;
  });

it.effect(
  "opens a Zotero attachment that Obsidian opens by its file in the reader, and keeps another PDF in Obsidian's view",
  () =>
    Effect.gen(function* () {
      const reader = yield* readerOver(true);
      expect(yield* shownAs(ZOTERO_PDF)).toBe("pdf");

      yield* reader.connect();

      expect(yield* shownAs(ZOTERO_PDF)).toBe(READER);
      expect(yield* shownAs(OTHER_PDF)).toBe("pdf");
    }),
);

it.effect(
  "waits for the first attachment index before it chooses the view",
  () =>
    Effect.gen(function* () {
      const reader = yield* readerOver(false);
      yield* reader.connect();

      expect(yield* shownAs(ZOTERO_PDF)).toBe(READER);
    }),
);

it.effect("stops choosing the view when its layer closes", () =>
  Effect.gen(function* () {
    const reader = yield* readerOver(true);
    yield* reader.connect();
    yield* reader.close;

    expect(yield* shownAs(ZOTERO_PDF)).toBe("pdf");
  }),
);
