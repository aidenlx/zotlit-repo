// The real editor Layer behind the public Promise/DOM binding test seam.
import { Clock, DateTime, Effect, Layer } from "effect";
import type { App, FileSystemAdapter, TFile, View } from "obsidian";

import type { PdfReader } from "@zotlit/pdf-reader";
import type {
  ObsidianHostContext,
  PdfReaderView,
} from "@zotlit/pdf-reader/obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { WorkspaceSource } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { CapabilityNotices } from "#obsidian/annotation-repository/notices.ts";
import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import { AnnotationNoteActions } from "#obsidian/annot-view/note-actions.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ReaderConnection } from "#obsidian/reader-connection/service.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

import type { FakeReader } from "#__fixtures__/pdf-annotation-editor.ts";
import { PdfAnnotationEditor, layerPdfAnnotationEditor } from "#obsidian/pdf-annotation-editor/service.ts";
import type {
  AnnotationReads,
  AttachmentReads,
  CapabilityGestures,
  MarkGestures,
} from "#obsidian/pdf-annotation-editor/service.ts";

interface EditorFixtureOptions {
  app: App;
  workspace?: WorkspaceSource;
  attachments: AttachmentReads;
  annotations: AnnotationReads;
  capabilityGestures: CapabilityGestures;
  markGestures: Pick<MarkGestures, "blockedPress" | "revealAnnotation">;
  noteIndex: Pick<NoteIndex["Service"], "getNotesByItemKey">;
  settings: Pick<PluginSettings["Service"], "current" | "update">;
  now?: () => DateTime.Utc;
  recordUse?: (itemKey: string) => void;
  /** Where the editor's notices go; a fresh recording one unless given. */
  notifier?: ReturnType<typeof testNotifier>;
  reader?: Layer.Layer<ReaderConnection>;
}

const layerNoReader = layerReaderConnection((handlers) => {
  handlers.onAbsent();
  return () => {};
});

/** The actual layer; only its external services have typed test substitutes. */
export function editorFixtureLayer(options: EditorFixtureOptions) {
  const deps = Layer.mergeAll(
    layerWorkspaceFrom(options.workspace ?? options.app.workspace),
    (options.notifier ?? testNotifier()).layer,
    Layer.mock(Vault, {
      fullPath: (path) =>
        Effect.sync(() =>
          (options.app.vault.adapter as FileSystemAdapter).getFullPath(path),
        ),
    }),
    Layer.mock(AttachmentResolver, options.attachments),
    Layer.mock(AnnotationRepository, options.annotations),
    Layer.mock(NoteIndex, options.noteIndex),
    Layer.mock(PluginSettings, options.settings),
    Layer.mock(UseLedger, {
      record: (key, kind, instant) =>
        Effect.sync(() => {
          options.recordUse?.(key);
          return { kind, instant: instant ?? DateTime.makeUnsafe(0) };
        }),
    }),
    Layer.mock(ZoteroReads, {
      reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {}),
    }),
    Layer.mock(ZoteroLocalApi, {
      state: Effect.succeed({ kind: "probing" } as const),
    }),
    // A mark dragged out inserts nothing through these seams.
    Layer.mock(AnnotationNoteActions, {}),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
          dataDir: "/zotero",
        }),
      ),
    }),
    Layer.mock(CapabilityNotices, {
      reportBlockedGesture: (key) =>
        Effect.sync(() => options.capabilityGestures.reportBlockedGesture(key)),
      showEditingCapability: Effect.sync(() =>
        options.capabilityGestures.allowEditing(),
      ),
    }),
  );
  const layer = layerPdfAnnotationEditor({
    readers: { borrow: () => null },
    revealAnnotation: options.markGestures.revealAnnotation,
    blockedPress: options.markGestures.blockedPress,
  }).pipe(
    Layer.provide(deps),
    Layer.provideMerge(options.reader ?? layerNoReader),
  );
  return options.now
    ? layer.pipe(
        Layer.provide(
          Layer.effect(
            Clock.Clock,
            Effect.map(Clock.Clock, (clock) => ({
              currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
              currentTimeNanos: clock.currentTimeNanos,
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              sleep: (duration) => clock.sleep(duration),
              currentTimeMillisUnsafe: () => DateTime.toEpochMillis(options.now!()),
              currentTimeMillis: Effect.sync(
                () => DateTime.toEpochMillis(options.now!()),
              ),
            })),
          ),
        ),
      )
    : layer;
}

export interface OpenReaderView {
  readonly fake: FakeReader;
  readonly file: unknown;
}

export function attachReader(
  editor: PdfAnnotationEditor["Service"],
  view: OpenReaderView,
  {
    restored = false,
    unloading = () => false,
  }: { restored?: boolean; unloading?: () => boolean } = {},
): Disposable | void {
  return editor.extension.attach?.({
    reader: view.fake.reader as PdfReader,
    host: stubService<ObsidianHostContext>("ObsidianHostContext", {
      view: view as unknown as PdfReaderView,
      file: view.file as TFile,
      restored,
      unloading,
    }),
    subpath: null,
  });
}

export async function openPdfEditor(
  options: EditorFixtureOptions & { open?: readonly OpenReaderView[] },
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(editorFixtureLayer(options), stack);
  await runtime.context();
  const service = runtime.runSync(PdfAnnotationEditor);
  const bridge = effectBridge(runtime);
  const owned = stack.move();
  let unloading = false;
  const attached = new Map<OpenReaderView, Disposable | void>();
  const attach = (
    view: OpenReaderView,
    { restored = false, opened = true } = {},
  ) => {
    attached.set(
      view,
      attachReader(service, view, { restored, unloading: () => unloading }),
    );
    if (opened) view.fake.openDocument();
  };
  const detach = (view: OpenReaderView) => {
    const instance = attached.get(view);
    attached.delete(view);
    instance?.[Symbol.dispose]();
  };
  for (const view of options.open ?? []) attach(view, { restored: true });
  return {
    service,
    runtime,
    attach,
    detach,
    get bindings() {
      return bridge.runSync(service.bindings);
    },
    bindingFor: (view: unknown) =>
      bridge.runSync(service.bindingFor(view as View)),
    sessionFor: (view: unknown) =>
      bridge.runSync(service.sessionFor(view as View)),
    borrowDocument: (path: string) =>
      bridge.runSync(service.borrowDocument(path)),
    subscribe: (callback: (path: string) => void) =>
      bridge.subscribe(service.sessionAdded, callback),
    [Symbol.asyncDispose]: async () => {
      unloading = true;
      for (const view of [...attached.keys()].reverse()) detach(view);
      await owned.disposeAsync();
    },
  };
}
