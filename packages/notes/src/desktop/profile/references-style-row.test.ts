import type { DefaultLiteratureNoteProfile } from "#obsidian/profile/settings.ts";
// @vitest-environment happy-dom
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Layer,
  PlatformError,
  SubscriptionRef,
} from "effect";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, vi } from "vitest";

import { STYLE_DEFAULT } from "@zotlit/citations/core/pandoc/citation-style.ts";
import {
  DropdownComponent,
  ExtraButtonComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  failureOf,
  recordingRuns,
} from "@zotlit/plugin-services/__fixtures__/setting-tab-harness.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import {
  PluginSettings,
  RESET_SETTING,
  SettingsMutationError,
} from "@zotlit/plugin-services/obsidian/settings/service.ts";

import {
  referencesStyleDefinition,
  referencesStyleDescription,
} from "./references-style-row.ts";

import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";

/**
 * Style folder reads a case holds in flight, the folders it refuses to list,
 * the folders read so far, and the reads whose end a case awaits, by folder
 * path.
 */
interface StyleReads {
  readonly held: Map<string, Deferred.Deferred<void>>;
  readonly denied: Set<string>;
  readonly started: Set<string>;
  readonly ended: Map<
    string,
    Deferred.Deferred<Exit.Exit<string[], PlatformError.PlatformError>>
  >;
}

/**
 * The Node file system, with each styles folder read going through `reads`: a
 * held read waits for its release, a denied folder refuses to be listed, and
 * an awaited read reports how it ended.
 */
const styleFileSystem = (reads: StyleReads) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) =>
      FileSystem.make({
        ...fs,
        readDirectory: (path, options) =>
          Effect.gen(function* () {
            reads.started.add(path);
            const held = reads.held.get(path);
            if (held) yield* Deferred.await(held);
            if (reads.denied.has(path))
              return yield* PlatformError.systemError({
                _tag: "PermissionDenied",
                module: "FileSystem",
                method: "readDirectory",
                pathOrDescriptor: path,
              });
            return yield* fs.readDirectory(path, options);
          }).pipe(
            Effect.onExit((exit) => {
              const ended = reads.ended.get(path);
              return ended ? Deferred.succeed(ended, exit) : Effect.void;
            }),
          ),
      }),
    ),
  ).pipe(Layer.provide(NodeFileSystem.layer));

const APA = { id: "http://www.zotero.org/styles/apa", title: "APA" };
const NATURE = { id: "http://www.zotero.org/styles/nature", title: "Nature" };
const CHICAGO = {
  id: "http://www.zotero.org/styles/chicago-author-date",
  title: "Chicago",
};

beforeAll(() => {
  globalThis.createEl = ((tag: string) =>
    document.createElement(tag)) as typeof createEl;
});

/** Settings whose default Profile binds `style` as its References style. */
const withStyle = (style: string | null): Settings => ({
  ...defaults,
  "note.default-profile": {
    ...defaults["note.default-profile"],
    bindings: {
      ...defaults["note.default-profile"].bindings,
      "citation.references-style": style,
    },
  },
});

/** A CSL file shaped like the ones Zotero installs. */
const cslXml = ({ id, title }: { id: string; title: string }) =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">',
    `  <info><title>${title}</title><id>${id}</id></info>`,
    "</style>",
  ].join("\n");

/** A Zotero data folder of its own, removed when the case ends. */
const dataFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-styles-row-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);

/** Install `style` into the data folder `dir`, as Zotero does. */
const install = (dir: string, style: { id: string; title: string }) =>
  Effect.promise(async () => {
    await mkdir(join(dir, "styles"), { recursive: true });
    await writeFile(join(dir, "styles", `${style.title}.csl`), cslXml(style));
  });

/** Wait until `assert` passes: the row reads the folder on real time. */
const eventually = (assert: () => void) =>
  Effect.promise(() => vi.waitFor(assert, { timeout: 2000, interval: 5 }));

describe("References style row", () => {
  /**
   * The rendered row over a Zotero data folder at `dataDir` and settings that
   * start as `settings`; `write` answers a choice.
   */
  const setup = Effect.fn("setup")(function* (
    dataDir: string,
    {
      settings = withStyle(null),
      write = () => Effect.void,
    }: {
      settings?: Settings;
      /** Answers the default Profile bindings a choice writes. */
      write?: (
        bindings: DefaultLiteratureNoteProfile["bindings"],
      ) => Effect.Effect<void, SettingsMutationError>;
    } = {},
  ) {
    const reads: StyleReads = {
      held: new Map(),
      denied: new Set(),
      started: new Set(),
      ended: new Map(),
    };
    const snapshot: ZoteroPrefSnapshot = {
      state: "ready",
      prefs: new Map(),
      resolvedProfileDir: null,
      profileDirOverride: null,
      dataDirOverride: null,
      dataDir,
      databasePath: join(dataDir, "zotero.sqlite"),
      sourceId: null,
      baseAttachmentPath: null,
      httpPort: null,
    };
    const pref = yield* SubscriptionRef.make(snapshot);
    const stored = yield* SubscriptionRef.make(settings);
    const services = yield* Layer.build(
      Layer.mergeAll(
        styleFileSystem(reads),
        Layer.mock(PluginSettings, {
          current: SubscriptionRef.get(stored),
          changes: SubscriptionRef.changes(stored),
          update: (patch) =>
            Effect.gen(function* () {
              const current = yield* SubscriptionRef.get(stored);
              const next = typeof patch === "function" ? patch(current) : patch;
              const profile = next["note.default-profile"];
              if (profile !== undefined && profile !== RESET_SETTING)
                yield* write(profile.bindings);
              return current;
            }),
        }),
        Layer.mock(ZoteroPref, {
          current: SubscriptionRef.get(pref),
          changes: SubscriptionRef.changes(pref),
        }),
      ),
    );
    const { tab, runs } = recordingRuns(
      (yield* scopedSettingTab(services)).tab,
    );
    const ctx = stubService<SettingTabContext>("SettingTabContext", { tab });
    const setting = renderRow(referencesStyleDefinition(ctx));
    yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
    const dropdown = setting.components.find(
      (control) => control instanceof DropdownComponent,
    );
    const refresh = setting.components.find(
      (control) => control instanceof ExtraButtonComponent,
    );
    if (!dropdown || !refresh) throw new Error("Expected the style controls");
    const paint = vi.spyOn(dropdown.selectEl, "replaceChildren");
    return {
      dropdown,
      refresh,
      /** The handler Effects the row started, with how each ended. */
      runs,
      /** The styles folder reads, which a case holds or refuses. */
      reads,
      /** The data folder the Zotero preferences resolve to. */
      moveDataFolder: (dir: string) =>
        SubscriptionRef.update(pref, (current) => ({
          ...current,
          prefs: new Map(),
          dataDir: dir,
        })),
      /** Settings as vault sync rewrites them while the tab stays open. */
      store: (next: Settings) => SubscriptionRef.set(stored, next),
      /** How many times the row has filled the dropdown so far. */
      paints: () => paint.mock.calls.length,
      /** The titles the dropdown offers after the embedded default. */
      titles: () => dropdown.options.slice(1).map(({ label }) => label),
    };
  });

  it.live("lists the styles Zotero installed and selects the saved one", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      yield* install(dir, NATURE);
      const row = yield* setup(dir, { settings: withStyle(NATURE.id) });

      yield* eventually(() => expect(row.titles()).toEqual(["APA", "Nature"]));
      expect(row.dropdown.getValue()).toBe(NATURE.id);
    }),
  );

  it.live("reads the folder again on Refresh", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      yield* install(dir, NATURE);
      row.refresh.click();

      yield* eventually(() => expect(row.titles()).toEqual(["APA", "Nature"]));
    }),
  );

  it.live("keeps the last list when a Refresh cannot read the folder", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      row.reads.denied.add(join(dir, "styles"));
      const painted = row.paints();
      row.refresh.click();

      // The row paints once the failed read has settled to a list.
      yield* eventually(() => expect(row.paints()).toBe(painted + 1));
      expect(row.titles()).toEqual(["APA"]);
    }),
  );

  it.live(
    "lists the newest data folder's styles when the folder moves twice",
    () =>
      Effect.gen(function* () {
        const first = yield* dataFolder;
        const second = yield* dataFolder;
        const third = yield* dataFolder;
        yield* install(first, APA);
        yield* install(second, NATURE);
        yield* install(third, CHICAGO);
        const row = yield* setup(first);
        yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

        // The read of the folder in between stays in flight until released.
        const held = yield* Deferred.make<void>();
        const ended =
          yield* Deferred.make<
            Exit.Exit<string[], PlatformError.PlatformError>
          >();
        const secondStyles = join(second, "styles");
        row.reads.held.set(secondStyles, held);
        row.reads.ended.set(secondStyles, ended);
        yield* row.moveDataFolder(second);
        yield* eventually(() =>
          expect(row.reads.started.has(secondStyles)).toBe(true),
        );
        yield* row.moveDataFolder(third);
        yield* eventually(() => expect(row.titles()).toEqual(["Chicago"]));

        yield* Deferred.succeed(held, undefined);
        // The newer read ended the stale one, so its list never reaches the row.
        expect(Exit.hasInterrupts(yield* Deferred.await(ended))).toBe(true);
        expect(row.titles()).toEqual(["Chicago"]);
      }),
  );

  it.live("follows a References style that vault sync rewrites", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const row = yield* setup(dir);
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      yield* row.store(withStyle(APA.id));

      yield* eventually(() => expect(row.dropdown.getValue()).toBe(APA.id));
    }),
  );

  it.live("saves the chosen style to the default Profile", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      yield* install(dir, APA);
      const write = vi.fn(
        (_bindings: DefaultLiteratureNoteProfile["bindings"]) => Effect.void,
      );
      const row = yield* setup(dir, { write });
      yield* eventually(() => expect(row.titles()).toEqual(["APA"]));

      row.dropdown.choose(APA.id);
      row.dropdown.choose(STYLE_DEFAULT);

      yield* eventually(() =>
        expect(
          write.mock.calls.map(
            ([bindings]) => bindings["citation.references-style"],
          ),
        ).toEqual([APA.id, null]),
      );
    }),
  );

  it.live("fails the style save under its label when the save fails", () =>
    Effect.gen(function* () {
      const dir = yield* dataFolder;
      const failure = new SettingsMutationError({
        message: "disk full",
        cause: null,
      });
      const write = vi.fn(
        (_bindings: DefaultLiteratureNoteProfile["bindings"]) =>
          Effect.fail(failure),
      );
      const row = yield* setup(dir, { write });

      row.dropdown.choose(STYLE_DEFAULT);

      yield* eventually(() => expect(row.runs).toHaveLength(1));
      expect(
        write.mock.calls.map(
          ([bindings]) => bindings["citation.references-style"],
        ),
      ).toEqual([null]);
      expect(failureOf(row.runs[0]!)).toBe(failure);
      expect(row.runs[0]!.label).toBe(m.settings_failed_save());
    }),
  );
});

describe("referencesStyleDescription", () => {
  it("names the recovery step only when Zotero lacks the selection", () => {
    expect(referencesStyleDescription(false).textContent).toBe(
      m.settings_citation_references_style_desc(),
    );
    expect(referencesStyleDescription(true).textContent).toBe(
      m.settings_citation_references_style_warning(),
    );
  });
});
