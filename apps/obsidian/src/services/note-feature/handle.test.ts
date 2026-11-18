// The Note Feature's edge handle: Promise answers over the plugin runtime.
// The members are Promise edges on purpose, so these cases stay plain.
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { Item } from "@zotlit/db";
import { MemoryFileManager } from "@zotlit/obsidian-kit/__fixtures__/obsidian-file-manager.ts";
import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";

import type { AttachmentImport } from "@/services/attachment-import/service.ts";
import { profileReader } from "@/services/profile/__fixtures__/reader.ts";
import { defaults } from "@/services/settings/schema.ts";

import { noteFeatureHandle } from "./__fixtures__/note-feature.ts";

const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;
const ITEM = stubService<Item>("Item", { itemID: 1, indexedKey: "ABCD2345" });

/** The handle over a runtime that holds the Note Feature and its services. */
function harness() {
  const stack = new AsyncDisposableStack();
  const settings = { ...defaults, profiles: [{ id: PAPERS, label: "Papers" }] };
  const reads = readsAnswering({
    ItemsByIndexedKeys: () =>
      Effect.succeed(new Map([[ITEM.indexedKey, ITEM]])),
    // The Snapshot lost the Item between the preview and its create.
    NoteSource: () => Effect.succeed(null),
  });
  const host = createObsidianHost();
  const { handle } = noteFeatureHandle(
    {
      profile: profileReader(settings),
      noteIndex: {
        whenIndexed: async () => {},
        getNotesByItemKey: () => [],
        getImportedNoteByNoteKey: () => [],
      },
      zoteroReads: { reads, snapshot: Effect.succeed(reads) },
      template: {
        render: () => "",
        renderManagedContent: () => "",
        renderFilename: () => "",
        getLiteratureNoteTemplate: () => undefined,
        frontmatterFields: [],
      },
      app: {
        ...host.app,
        fileManager: new MemoryFileManager(),
      },
      settings: {
        current: Effect.succeed(settings),
        update: () => Effect.succeed(settings),
      },
      zoteroPref: { dataDir: "/zotero", baseAttachmentPath: null },
      attachmentImport: stubService<
        Pick<AttachmentImport["Service"], "prepare">
      >("AttachmentImport", {}),
    },
    stack,
  );
  return {
    handle,
    host,
    settings,
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
    dispose: () => stack.disposeAsync(),
  };
}

describe("bindNoteFeature", () => {
  it("resolves with the member's result", async () => {
    await using h = harness();
    const note = h.host.vault.addFile("Notes/Paper.md", "Body");
    await expect(h.handle.replacedKeys(note)).resolves.toEqual(new Set());
  });

  it("settles as the bridge does once the runtime is disposed", async () => {
    const h = harness();
    const note = h.host.vault.addFile("Notes/Paper.md", "Body");
    await h.dispose();
    // A read answers from the services the bridge captured.
    await expect(h.handle.replacedKeys(note)).resolves.toEqual(new Set());
    // Unload interrupts a write, which rejects with an AbortError.
    await expect(h.handle.createNote(ITEM)).rejects.toBeInstanceOf(AbortError);
  });
});
