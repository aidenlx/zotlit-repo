// A notes-table test host over the index and creation boundaries its tests drive.
import { Effect, Layer, Stream } from "effect";
import type { TFile } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import type { SubscriptionRuntime } from "@zotlit/plugin-kernel/effect-stream.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { DEFAULT_PROFILE } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { NoteFeatureHandle } from "@zotlit/notes/desktop/note-feature/operations.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import type { buildNoteIndex } from "@zotlit/plugin-services/obsidian/note-index/__fixtures__.ts";
import { noteIndexSnapshotAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { literatureNotes } from "#desktop/query-view/table-notes.ts";
import type {
  LiteratureNotesDeps,
  VaultEdit,
  VaultWrite,
} from "#desktop/query-view/table-notes.ts";
import { waitFor } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";

export interface NotesHostDeps {
  runtime: SubscriptionRuntime;
  app: LiteratureNotesDeps["app"];
  noteIndex: ReturnType<typeof buildNoteIndex>;
  profile: { changed: Stream.Stream<void> };
  template: { "compile-status-changed": Stream.Stream<void> };
  zoteroReads: Pick<ZoteroReads["Service"], "reads">;
  noteFeature: Pick<
    NoteFeatureHandle,
    "replacedKeys" | "createNoteInteractively"
  >;  /** The vault's file at `path`, as the table resolves a note it keys by path. */
  getFile: (path: string) => TFile | null;
}

export async function makeNotesHost(deps: NotesHostDeps) {
  const stack = new AsyncDisposableStack();
  const notifier = testNotifier();
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(),
      notifier.layer,
      Layer.mock(Workspace, {
        openLinkText: (link, source, options) =>
          Effect.promise(() =>
            deps.app.workspace.openLinkText(link, source, options?.newLeaf),
          ),
      }),
      Layer.succeed(NoteIndex, deps.noteIndex.runtime.runSync(NoteIndex)),
      Layer.mock(Vault, {
        getFileByPath: (path) => Effect.sync(() => deps.getFile(path)),
      }),
      Layer.mock(Profile, {
        changes: Stream.concat(Stream.make(null), deps.profile.changed).pipe(
          Stream.map(() => ({
            loaded: true,
            profiles: [],
            diagnostics: [],
            defaultDocumentPath: "",
            templateStatus: {
              state: "loaded" as const,
              compileErrors: new Map(),
            },
          })),
        ),
      }),
      Layer.mock(Template, {
        compileEvents: deps.template["compile-status-changed"],
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>("ZoteroReadsApi", {
          ItemsByIndexedKeys: (request) =>
            deps.zoteroReads.reads.ItemsByIndexedKeys(request),
        }),
      }),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
      Layer.mock(NoteFeature, {
        replacedKeys: (file) =>
          Effect.promise(() => deps.noteFeature.replacedKeys(file)),
        planCreations: (keys) =>
          Effect.succeed(
            new Map(
              keys.map((key) => [
                key,
                {
                  item: undefined,
                  selection: {
                    source: "bound" as const,
                    selector: DEFAULT_PROFILE,
                    shouldAsk: false,
                  },
                  previews: [],
                },
              ]),
            ),
          ),
        createNote: (item) =>
          Effect.promise(async () => {
            const file = await deps.noteFeature.createNoteInteractively(item);
            return file
              ? { outcome: "created" as const, file }
              : {
                  outcome: "refused" as const,
                  diagnostic: {
                    code: "literature-note-exists" as const,
                    hint: "",
                    indexedKey: item.indexedKey,
                    paths: ["cancelled.md"] as [string],
                  },
                };
          }),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  stack.defer(registry.mount(noteIndexSnapshotAtom));
  await waitFor(() => {
    if (!registry.get(noteIndexSnapshotAtom).ready)
      throw new Error("Note Index snapshot pending");
  });
  const notes = literatureNotes({
    app: deps.app,
    registry,
    creation: {
      app: deps.app,
      createProfile: () => Effect.undefined,
      importProfile: () => Effect.undefined,
    },
  });
  stack.defer(notes.on("changed", () => {}));
  return {
    notes,
    registry,
    /** Write a vault property, as a leaf runs the write, and its answer. */
    write: (edit: VaultEdit): Promise<VaultWrite> =>
      runtime.runPromise(notes.write(edit)),
    async [Symbol.asyncDispose]() {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
