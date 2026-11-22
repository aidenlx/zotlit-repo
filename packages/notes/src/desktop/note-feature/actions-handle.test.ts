import type { NoteImportView } from "#desktop/note-import/view.ts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";

import { bindNoteActions } from "./actions-handle.ts";
import type { NoteActionServices } from "./actions-view.ts";
import type { UpdateResult } from "./operations.ts";
import { NoteFeature } from "./service.ts";
import type { BatchUpdateNotices } from "./update-single.ts";

import { unimplementedProfileDialogServices } from "#__fixtures__/profile/dialogs.ts";
import { NoteImporter } from "#desktop/note-import/service.ts";
import { Profile } from "#obsidian/profile/service.ts";

const UPDATED: UpdateResult = { bodyUpdated: true, duplicateRegionCount: 0 };
const OPTIONS = { itemKey: "ABCD2345", scope: "full" } as const;

function actionsOver(updateNote: NoteFeature["Service"]["updateNote"]) {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      unimplementedProfileDialogServices,
      Layer.mock(NoteFeature, { updateNote }),
      testNotifier().layer,
      Layer.mock(LibraryScope, {}),
      Layer.mock(MetadataCache, {}),
      Layer.mock(NoteImporter, {}),
      Layer.mock(NoteIndex, {}),
      Layer.mock(PluginSettings, {}),
      Layer.mock(Profile, {}),
      Layer.mock(Workspace, {}),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReadsApi>("ZoteroReadsApi", {}),
      }),
      Layer.mock(ZoteroPref, {}),
    ),
  );
  const app = stubService<App>("App", {});
  const actions = bindNoteActions(
    effectBridge(runtime),
    runtime.runSync(Effect.context<NoteActionServices>()),
    {
      creation: { app, createProfile: vi.fn(), importProfile: vi.fn() },
      view: stubService<NoteImportView>("NoteImportView", {}),
      notices: stubService<BatchUpdateNotices>("BatchUpdateNotices", {}),
    },
  );
  return { runtime, actions };
}

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

it("resolves when the action ends, after it updated the note", async () => {
  const file = noteAt("Books/Paper.md");
  const updateNote = vi.fn<NoteFeature["Service"]["updateNote"]>(() =>
    Effect.succeed(UPDATED),
  );
  const { runtime, actions } = actionsOver(updateNote);

  await expect(actions.updateNote(file, OPTIONS)).resolves.toBeUndefined();
  expect(updateNote).toHaveBeenCalledWith(file, {
    indexedKey: "ABCD2345",
    scope: "full",
  });
  await runtime.dispose();
});

it("resolves an action called after unload and stops it at its first wait", async () => {
  let finished = false;
  const { runtime, actions } = actionsOver(() =>
    Effect.yieldNow.pipe(
      Effect.andThen(
        Effect.sync(() => {
          finished = true;
        }),
      ),
      Effect.as(UPDATED),
    ),
  );
  await runtime.dispose();

  await expect(
    actions.updateNote(noteAt("Books/Paper.md"), OPTIONS),
  ).resolves.toBeUndefined();
  expect(finished).toBe(false);
});

it("interrupts an action in flight at unload and resolves", async () => {
  const started = Promise.withResolvers<void>();
  let interrupted = false;
  const { runtime, actions } = actionsOver(() =>
    Effect.sync(() => started.resolve()).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    ),
  );

  const pending = actions.updateNote(noteAt("Books/Paper.md"), OPTIONS);
  await started.promise;
  await runtime.dispose();

  await expect(pending).resolves.toBeUndefined();
  expect(interrupted).toBe(true);
});
