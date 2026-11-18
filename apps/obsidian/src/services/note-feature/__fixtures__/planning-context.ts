// The services creation planning reads, over a Note Feature test's plain deps.
import { Context, Effect } from "effect";
import type {
  MetadataCache as ObsidianMetadataCache,
  Vault as ObsidianVault,
} from "obsidian";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { QueryService } from "@/services/item-query/service.ts";
import type { TFile } from "obsidian";
import { NoteIndex } from "@/services/note-index/service.ts";
import type { ProfileReader } from "@/services/profile/service.ts";
import { Profile } from "@/services/profile/service.ts";
import { Template, templateFailure } from "@/services/template/service.ts";
import type { TemplateOperations } from "@/services/template/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { CreationPlanningServices } from "@/services/note-feature/creation-planning.ts";

/** The plain deps the planning services read, as a Note Feature test holds them. */
export interface PlanningSources {
  profile: Pick<ProfileReader, "profiles" | "resolveProfile" | "profileOf">;
  noteIndex: {
    whenIndexed(): Promise<void>;
    getNotesByItemKey(key: string): TFile[];
    getImportedNoteByNoteKey(key: string): TFile[];
  };
  zoteroReads: Pick<ZoteroReads["Service"], "reads" | "snapshot">;
  template: Pick<
    TemplateOperations,
    "renderFilename" | "getLiteratureNoteTemplate" | "frontmatterFields"
  >;
  app: {
    vault: Pick<ObsidianVault, "getAbstractFileByPath">;
    metadataCache: Pick<ObsidianMetadataCache, "getFileCache">;
  };
}

/**
 * The planning services over `sources`. Each member reads `sources` when it
 * runs, so a test may replace a dep after it builds the context. `query`
 * stands for ZotLit Query; without one, a query fails the test.
 */
export function planningContext(
  sources: PlanningSources,
  query?: QueryService["Service"],
): Context.Context<CreationPlanningServices> {
  return Context.make(
    Profile,
    stubService<Profile["Service"]>("Profile", {
      profiles: Effect.sync(() => sources.profile.profiles),
      resolveProfile: (selector) =>
        Effect.sync(() => sources.profile.resolveProfile(selector)),
      profileOf: (file) => Effect.sync(() => sources.profile.profileOf(file)),
    }),
  ).pipe(
    Context.add(
      NoteIndex,
      stubService<NoteIndex["Service"]>("NoteIndex", {
        whenIndexed: Effect.tryPromise(() =>
          sources.noteIndex.whenIndexed(),
        ).pipe(Effect.orDie),
        getNotesByItemKey: (key) =>
          Effect.sync(() => sources.noteIndex.getNotesByItemKey(key)),
        getImportedNoteByNoteKey: (key) =>
          Effect.sync(() => sources.noteIndex.getImportedNoteByNoteKey(key)),
      }),
    ),
    Context.add(
      ZoteroReads,
      stubService<ZoteroReads["Service"]>("ZoteroReads", {
        reads: sources.zoteroReads.reads,
        snapshot: Effect.suspend(() => sources.zoteroReads.snapshot),
      }),
    ),
    Context.add(
      Template,
      // A throwing plain dep fails typed, as the real tag's members do.
      stubService<Template["Service"]>("Template", {
        renderFilename: (data) =>
          Effect.try({
            try: () => sources.template.renderFilename(data),
            catch: templateFailure,
          }),
        getLiteratureNoteTemplate: (reference) =>
          Effect.try({
            try: () => sources.template.getLiteratureNoteTemplate(reference),
            catch: templateFailure,
          }),
        frontmatterFields: Effect.try({
          try: () => sources.template.frontmatterFields,
          catch: templateFailure,
        }),
      }),
    ),
    Context.add(
      Vault,
      stubService<Vault["Service"]>("Vault", {
        getAbstractFileByPath: (path) =>
          Effect.sync(() => sources.app.vault.getAbstractFileByPath(path)),
      }),
    ),
    Context.add(
      MetadataCache,
      stubService<MetadataCache["Service"]>("MetadataCache", {
        fileCache: (file) =>
          Effect.sync(() => sources.app.metadataCache.getFileCache(file)),
      }),
    ),
    Context.add(
      QueryService,
      query ??
        stubService<QueryService["Service"]>("QueryService", {
          run: () => Effect.die(new Error("This test runs no query.")),
        }),
    ),
  );
}
