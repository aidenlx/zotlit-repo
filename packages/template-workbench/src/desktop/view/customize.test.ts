// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import { describe, expect } from "vitest";

import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import type { LiteratureNoteProfile } from "@zotlit/notes/obsidian/profile/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { customize } from "./customize.ts";
import type {
  CustomizeItem,
  CustomizePorts,
  CustomizeRequest,
} from "./customize.ts";

const DEFAULT_DOCUMENT = "templates/zotlit-profile.default.md";

interface Options {
  activeNote?: { basename: string; itemKey: string | null } | null;
  /** The Profiles the registry holds; the vault holds each one's file. */
  profiles?: readonly LiteratureNoteProfile[];
}

/** The flow over memory services, with the documents and papers it opened. */
function harness({ activeNote = null, profiles = [] }: Options = {}) {
  const workspace = new MemoryWorkspace();
  const metadataCache = new MemoryMetadataCache();
  if (activeNote) {
    const file = new TFile();
    file.path = `literatures/${activeNote.basename}.md`;
    file.basename = activeNote.basename;
    workspace.activeFile = file;
    metadataCache.entries.set(file.path, {
      frontmatter: activeNote.itemKey
        ? { "zotero-key": activeNote.itemKey }
        : {},
    });
  }
  const vault = new MemoryVault();
  for (const { path } of profiles) vault.add(path);

  const layer = Layer.mergeAll(
    layerHost({ workspace, metadataCache, vault }),
    testNotifier().layer,
    Layer.mock(Profile, {
      profiles: Effect.succeed(profiles),
      defaultDocumentPath: Effect.succeed(DEFAULT_DOCUMENT),
    }),
  );
  const openedFiles: string[] = [];
  const items: (CustomizeItem | null | undefined)[] = [];
  const ports: CustomizePorts = {
    openView: (request, target) =>
      Effect.sync(() => {
        items.push(request.item);
        openedFiles.push(
          target instanceof TFile ? target.path : target.defaultDocumentPath,
        );
      }),
  };
  return {
    customize: (request: CustomizeRequest) =>
      customize(request, ports).pipe(Effect.provide(layer)),
    openedFiles,
    items,
  };
}

describe("the Customize flow", () => {
  it.effect("opens a named Profile's own document in the view", () =>
    Effect.gen(function* () {
      const books: LiteratureNoteProfile = {
        id: "Bk3Qn7XvT2Lp" as ProfileId,
        label: "Books",
        document: "zotlit-profile.books.md",
        path: "templates/zotlit-profile.books.md",
        bindings: {},
        match: { state: "absent", summary: m.profile_match_absent() },
      };
      const local = harness({ profiles: [books] });

      yield* local.customize({ profileId: books.id });
      yield* local.customize({ profileId: "Zz9Zz9Zz9Zz9" as ProfileId });

      // A Profile the registry does not hold opens nothing.
      expect(local.openedFiles).toEqual([books.path]);
    }),
  );

  it.effect("opens the Default Profile by its document path", () =>
    Effect.gen(function* () {
      const local = harness();

      yield* local.customize({ profileId: "default" });

      expect(local.openedFiles).toEqual([DEFAULT_DOCUMENT]);
    }),
  );

  it.effect(
    "takes the active Literature Note's paper, and a Sample Item without one",
    () =>
      Effect.gen(function* () {
        const withNote = harness({
          activeNote: {
            basename: "Why most published research findings are false",
            itemKey: "IANNP5A2",
          },
        });
        yield* withNote.customize({ profileId: "default" });
        expect(withNote.items).toEqual([
          {
            key: "IANNP5A2",
            title: "Why most published research findings are false",
          },
        ]);

        const plain = harness({
          activeNote: { basename: "Reading list", itemKey: null },
        });
        yield* plain.customize({ profileId: "default" });
        expect(plain.items).toEqual([null]);
      }),
  );
});
