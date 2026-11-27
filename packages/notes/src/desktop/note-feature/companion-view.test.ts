import type { LiteratureNoteProfileChoice } from "#desktop/profile/profile-picker.ts";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import type { Item, ItemRef } from "@zotlit/db";
import {
  noticeContentOf,
  testNotifier,
} from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import type { ReadsAnswers } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { companionLinkNotice, followCompanionLink } from "./companion-view.ts";
import type {
  PlannedCreation,
  PlannedCreationProfile,
} from "./creation-planning.ts";
import { companionNoteNotice } from "./index.ts";
import type {
  CompanionNoteTarget,
  CreationProfileSelection,
  InteractiveCreationPorts,
} from "./index.ts";
import { openLiteratureNote } from "./navigation.ts";
import { NoteFeature } from "./service.ts";

import { unimplementedProfileDialogServices } from "#__fixtures__/profile/dialogs.ts";
import { openLiteratureNoteProfile } from "#desktop/profile/profile-picker.ts";

vi.mock("#desktop/profile/profile-picker.ts", () => ({
  openLiteratureNoteProfile: vi.fn(),
}));

function pickerAnswersOnce(answer: LiteratureNoteProfileChoice | undefined) {
  vi.mocked(openLiteratureNoteProfile).mockImplementationOnce(
    (_app, _options, resolve) => {
      resolve(answer);
      return { close: () => {} };
    },
  );
}

const REF: ItemRef = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD2345",
  groupID: null,
  indexedKey: "ABCD2345",
};
const BOOKS = "Bk3Qn7XvT2Lp" as ProfileId;
const PAPERS = "Rz9Wm4YfH6Kd" as ProfileId;

function creationPlans(
  indexedKeys: readonly string[],
  plan: PlannedCreation,
): ReadonlyMap<string, PlannedCreation> {
  return new Map(indexedKeys.map((key) => [key, plan]));
}

interface FlowServices {
  readonly workspace: MemoryWorkspace;
  readonly excluded: string[];
  readonly readItems?: ReadsAnswers["ItemsByIndexedKeys"];
  readonly notifier: ReturnType<typeof testNotifier>;
  readonly feature: Partial<NoteFeature["Service"]>;
}

function flowLayer({
  workspace,
  excluded,
  readItems,
  notifier,
  feature,
}: FlowServices) {
  return Layer.mergeAll(
    unimplementedProfileDialogServices,
    Layer.mock(NoteFeature, feature),
    layerWorkspaceFrom(workspace),
    notifier.layer,
    Layer.mock(UseLedger, {
      withoutNoteUse: (file, open) =>
        Effect.sync(() => excluded.push(file.path)).pipe(Effect.andThen(open)),
    }),
    Layer.mock(ZoteroReads, {
      reads: readsAnswering(readItems ? { ItemsByIndexedKeys: readItems } : {}),
      snapshot: Effect.succeed(
        readsAnswering(readItems ? { ItemsByIndexedKeys: readItems } : {}),
      ),
    }),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", { dataDir: "" }),
      ),
    }),
  );
}

function openedAt(
  path: string,
  newLeaf: MemoryWorkspace["opened"][number]["newLeaf"],
) {
  return {
    linktext: path,
    sourcePath: "",
    newLeaf,
    openViewState: { active: true },
  };
}

function creationHarness(selection: CreationProfileSelection) {
  const file = noteAt("Papers/Study.md");
  const item = { ...REF, fields: { title: "A Study" } } as Item;
  const readItems = vi.fn<NonNullable<ReadsAnswers["ItemsByIndexedKeys"]>>(() =>
    Effect.succeed(new Map([[REF.indexedKey, item]])),
  );
  const create = vi.fn(() =>
    Effect.succeed({ outcome: "created" as const, file }),
  );
  const previews: PlannedCreationProfile[] = [
    {
      selector: selection.selector,
      label: "Papers",
      folder: "Papers",
      citationStyle: null,
      document: undefined,
      path: file.path,
      create,
    },
  ];
  const planCreations = vi.fn<NoteFeature["Service"]["planCreations"]>((keys) =>
    Effect.succeed(creationPlans(keys, { item, selection, previews })),
  );
  const deps: InteractiveCreationPorts = {
    createProfile: vi.fn(),
    importProfile: vi.fn(),
    app: stubService<App>("App", {}),
  };
  const feature = {
    planCreations,
    createNote: create,
    resolveCompanionNote: vi.fn<NoteFeature["Service"]["resolveCompanionNote"]>(
      () => Effect.succeed({ outcome: "create" }),
    ),
    updateNote: vi.fn<NoteFeature["Service"]["updateNote"]>(() =>
      Effect.succeed({ bodyUpdated: true, duplicateRegionCount: 0 }),
    ),
  };
  const workspace = new MemoryWorkspace({ layoutReady: true });
  const excluded: string[] = [];
  return {
    deps,
    feature,
    file,
    item,
    readItems,
    create,
    planCreations,
    workspace,
    excluded,
    layer: flowLayer({
      workspace,
      excluded,
      readItems,
      notifier: testNotifier(),
      feature,
    }),
  };
}

it.effect.each(["open", "update"] as const)(
  "%s creates directly under the link's Profile and opens the path",
  (action) =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: PAPERS,
        source: "headless",
        shouldAsk: true,
      });
      vi.mocked(openLiteratureNoteProfile).mockClear();
      harness.planCreations.mockImplementation((keys) => {
        expect(harness.readItems).toHaveBeenCalledOnce();
        return Effect.succeed(
          creationPlans(keys, {
            item: harness.item,
            selection: {
              selector: PAPERS,
              source: "headless",
              shouldAsk: true,
            },
            previews: [
              {
                selector: PAPERS,
                label: "Papers",
                folder: "Papers",
                citationStyle: null,
                document: undefined,
                path: harness.file.path,
                create: harness.create,
              },
            ],
          }),
        );
      });
      yield* followCompanionLink(harness.deps, REF, {
        action,
        profile: PAPERS,
      }).pipe(Effect.provide(harness.layer));
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: PAPERS,
        },
      );
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(harness.create).toHaveBeenCalledOnce();
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", false),
      ]);
      expect(harness.excluded).toEqual(
        action === "update" ? ["Papers/Study.md"] : [],
      );
    }),
);

it.effect(
  "creates directly when a match selects the Profile for an unqualified link",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: PAPERS,
        source: "match",
        shouldAsk: true,
        reason: m.profile_match_selected({ profile: "Papers" }),
      });
      vi.mocked(openLiteratureNoteProfile).mockClear();
      yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
        Effect.provide(harness.layer),
      );
      expect(harness.planCreations).toHaveBeenCalledExactlyOnceWith(
        [harness.item.indexedKey],
        {
          headless: undefined,
        },
      );
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(harness.create).toHaveBeenCalledOnce();
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", false),
      ]);
    }),
);

it.effect("asks when the selected Profile is unavailable", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: true,
      problem: { kind: "unavailable-profile", selector: BOOKS },
    });
    pickerAnswersOnce(undefined);
    yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({
        preselected: "default",
        problem: expect.stringContaining(BOOKS),
      }),
      expect.any(Function),
    );
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.workspace.opened).toEqual([]);
  }),
);

it.effect("leaves a cancelled picker without a note or navigation", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: true,
    });
    pickerAnswersOnce(undefined);
    yield* followCompanionLink(harness.deps, REF, { action: "open" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(openLiteratureNoteProfile).toHaveBeenLastCalledWith(
      harness.deps.app,
      expect.objectContaining({ preselected: "default", source: "bound" }),
      expect.any(Function),
    );
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.workspace.opened).toEqual([]);
  }),
);

it.effect("creates directly when only Default is available", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: false,
    });
    vi.mocked(openLiteratureNoteProfile).mockClear();
    yield* followCompanionLink(harness.deps, REF, { action: "update" }).pipe(
      Effect.provide(harness.layer),
    );
    expect(harness.create).toHaveBeenCalledExactlyOnceWith(harness.item, {
      profile: "default",
    });
    expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
    expect(harness.planCreations).toHaveBeenCalledOnce();
    expect(harness.workspace.opened).toHaveLength(1);
  }),
);

it.effect(
  "keeps metadata-only missing-note updates outside the create flow",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "update",
          scope: "metadata",
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "metadata-no-note" });
      expect(harness.readItems).not.toHaveBeenCalled();
      expect(harness.planCreations).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
      expect(harness.workspace.opened).toEqual([]);
    }),
);

it.effect(
  "refuses an unknown URL Profile without opening or starting creation",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      const target = {
        outcome: "refused" as const,
        diagnostic: unknownProfileDiagnostic(PAPERS),
      };
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed(target),
      );
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "open",
          profile: PAPERS,
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "refused", target });
      expect(harness.workspace.opened).toEqual([]);
      expect(harness.readItems).not.toHaveBeenCalled();
      expect(companionNoteNotice(harness.deps.app, target)).toBe(
        m.notice_literature_note_profile_unknown({ stamp: PAPERS }),
      );
    }),
);

it.effect("opens a matching existing note and updates under its stamp", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: BOOKS,
      source: "headless",
      shouldAsk: true,
    });
    harness.feature.resolveCompanionNote.mockReturnValue(
      Effect.succeed({ outcome: "existing", files: [harness.file] }),
    );
    yield* followCompanionLink(harness.deps, REF, {
      action: "update",
      profile: BOOKS,
      scope: "metadata",
    }).pipe(Effect.provide(harness.layer));
    expect(harness.workspace.opened).toHaveLength(1);
    expect(harness.excluded).toEqual([harness.file.path]);
    expect(harness.feature.updateNote).toHaveBeenCalledExactlyOnceWith(
      harness.file,
      { indexedKey: "ABCD2345", scope: "metadata" },
    );
    expect(harness.create).not.toHaveBeenCalled();
  }),
);

it.effect(
  "opens an unknown existing stamp with recovery, while leaving its content unchanged",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: "default",
        source: "bound",
        shouldAsk: false,
      });
      const target: CompanionNoteTarget = {
        outcome: "existing",
        files: [harness.file],
        diagnostic: unknownProfileDiagnostic(`Missing (${PAPERS})`, {
          path: harness.file.path,
        }),
      };
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed(target),
      );
      expect(
        yield* followCompanionLink(harness.deps, REF, {
          action: "update",
          profile: "default",
        }).pipe(Effect.provide(harness.layer)),
      ).toEqual({ outcome: "opened-as-is", target });
      expect(harness.workspace.opened).toHaveLength(1);
      expect(harness.feature.updateNote).not.toHaveBeenCalled();
      expect(harness.create).not.toHaveBeenCalled();
      const notice = noticeContentOf(
        companionNoteNotice(harness.deps.app, target),
      );
      expect(noticeText(notice)).toContain(
        m.notice_literature_note_profile_unknown({
          stamp: `Missing (${PAPERS})`,
        }),
      );
      expect(notice.actions?.map((action) => action.label)).toEqual([
        m.profile_switch_recovery(),
      ]);
    }),
);

it.effect.each(["tab"] as const)(
  "opens an existing note in a new %s when the link names one",
  (paneType) =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: BOOKS,
        source: "headless",
        shouldAsk: false,
      });
      harness.feature.resolveCompanionNote.mockReturnValue(
        Effect.succeed({ outcome: "existing", files: [harness.file] }),
      );
      yield* followCompanionLink(harness.deps, REF, {
        action: "open",
        paneType,
      }).pipe(Effect.provide(harness.layer));
      expect(harness.workspace.opened).toEqual([
        openedAt("Papers/Study.md", paneType),
      ]);
    }),
);

it.effect("opens a note it just created in the pane the link names", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: "default",
      source: "bound",
      shouldAsk: false,
    });
    yield* followCompanionLink(harness.deps, REF, {
      action: "open",
      paneType: "window",
    }).pipe(Effect.provide(harness.layer));
    expect(harness.workspace.opened).toEqual([
      openedAt("Papers/Study.md", "window"),
    ]);
  }),
);

it("names Default in the kept-Profile notice for an unstamped note", () => {
  expect(
    companionNoteNotice(stubService<App>("App", {}), {
      outcome: "existing",
      files: [noteAt("Paper.md")],
      keptProfile: { selector: "default", label: undefined },
    }),
  ).toBe(
    m.notice_literature_note_profile_kept({
      label: m.settings_profile_default_name(),
    }),
  );
});

it.effect.each(["open", "update"] as const)(
  "%s opens a conflicting stamped note without updating it or asking",
  (action) =>
    Effect.gen(function* () {
      const file = noteAt("Books/Paper.md");
      const target = {
        outcome: "existing" as const,
        files: [file] as [TFile],
        keptProfile: { selector: BOOKS, label: "Books" },
      };
      const updateNote = vi.fn<NoteFeature["Service"]["updateNote"]>();
      const createNote = vi.fn<NoteFeature["Service"]["createNote"]>();
      const resolveCompanionNote = vi.fn<
        NoteFeature["Service"]["resolveCompanionNote"]
      >(() => Effect.succeed(target));
      const deps: InteractiveCreationPorts = {
        createProfile: vi.fn(),
        importProfile: vi.fn(),
        app: stubService<App>("App", {}),
      };
      const workspace = new MemoryWorkspace({ layoutReady: true });
      vi.mocked(openLiteratureNoteProfile).mockClear();

      const outcome = yield* followCompanionLink(deps, REF, {
        action,
        profile: PAPERS,
      }).pipe(
        Effect.provide(
          flowLayer({
            workspace,
            excluded: [],
            notifier: testNotifier(),
            feature: { resolveCompanionNote, updateNote, createNote },
          }),
        ),
      );

      expect(outcome).toEqual({ outcome: "opened-as-is", target });
      expect(workspace.opened).toEqual([openedAt("Books/Paper.md", false)]);
      expect(resolveCompanionNote).toHaveBeenCalledWith("ABCD2345", {
        profile: PAPERS,
      });
      expect(updateNote).not.toHaveBeenCalled();
      expect(createNote).not.toHaveBeenCalled();
      expect(openLiteratureNoteProfile).not.toHaveBeenCalled();
      expect(companionNoteNotice(deps.app, target)).toBe(
        m.notice_literature_note_profile_kept({ label: "Books" }),
      );
    }),
);

it("tells the user of a refused link, a note kept as is, and a metadata update with no note", () => {
  const app = stubService<App>("App", {});
  const refused = {
    outcome: "refused" as const,
    diagnostic: unknownProfileDiagnostic(PAPERS),
  };
  const kept = {
    outcome: "existing" as const,
    files: [noteAt("Books/Paper.md")] as [TFile],
    keptProfile: { selector: BOOKS, label: "Books" },
  };
  expect(
    companionLinkNotice(app, { outcome: "refused", target: refused }),
  ).toBe(m.notice_literature_note_profile_unknown({ stamp: PAPERS }));
  expect(
    companionLinkNotice(app, { outcome: "opened-as-is", target: kept }),
  ).toBe(m.notice_literature_note_profile_kept({ label: "Books" }));
  expect(companionLinkNotice(app, { outcome: "metadata-no-note" })).toBe(
    m.notice_update_metadata_no_note(),
  );
  expect(
    companionLinkNotice(app, { outcome: "opened", file: noteAt("Paper.md") }),
  ).toBeUndefined();
});

function noteAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

it.effect("opens an indexed Literature Note without planning a creation", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: PAPERS,
      source: "asked",
      shouldAsk: true,
    });
    const outcome = yield* openLiteratureNote(harness.deps, REF.indexedKey, {
      source: "interactive",
      paneType: "tab",
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.mock(NoteIndex, {
            whenIndexed: Effect.void,
            getNotesByItemKey: () => Effect.succeed([harness.file]),
          }),
        ),
      ),
    );
    expect(outcome).toEqual({ outcome: "opened", file: harness.file });
    expect(harness.planCreations).not.toHaveBeenCalled();
    expect(harness.workspace.opened).toEqual([
      openedAt(harness.file.path, "tab"),
    ]);
  }),
);

it.effect(
  "creates and opens an interactive Literature Note through its matched Profile",
  () =>
    Effect.gen(function* () {
      const harness = creationHarness({
        selector: PAPERS,
        source: "match",
        shouldAsk: false,
        reason: "Papers match",
      });
      const outcome = yield* openLiteratureNote(harness.deps, REF.indexedKey, {
        source: "interactive",
        paneType: "tab",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            harness.layer,
            Layer.mock(NoteIndex, {
              whenIndexed: Effect.void,
              getNotesByItemKey: () => Effect.succeed([]),
            }),
          ),
        ),
      );
      expect(outcome).toEqual({ outcome: "created", file: harness.file });
      expect(harness.workspace.opened).toEqual([
        openedAt(harness.file.path, "tab"),
      ]);
    }),
);

it.effect("opens nothing when the interactive Item read is unavailable", () =>
  Effect.gen(function* () {
    const harness = creationHarness({
      selector: PAPERS,
      source: "asked",
      shouldAsk: true,
    });
    harness.readItems.mockImplementation(() =>
      Effect.fail(new DbUnavailable({ message: "Database unavailable" })),
    );
    const outcome = yield* openLiteratureNote(harness.deps, REF.indexedKey, {
      source: "interactive",
      paneType: "tab",
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          harness.layer,
          Layer.mock(NoteIndex, {
            whenIndexed: Effect.void,
            getNotesByItemKey: () => Effect.succeed([]),
          }),
        ),
      ),
    );
    expect(outcome).toEqual({ outcome: "item-not-found" });
    expect(harness.workspace.opened).toEqual([]);
    expect(harness.planCreations).not.toHaveBeenCalled();
  }),
);
