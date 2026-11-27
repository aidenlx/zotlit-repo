import type {
  ZoteroPrefSnapshot,
  ZoteroProfileInfo,
} from "#core/zotero-pref/service.ts";
import type {
  LibrarySourceKind,
  LibrarySourceView,
} from "#obsidian/library-source/service.ts";
import type { OnlineLibraryStatus } from "#obsidian/library-source/status.ts";
import type { SettingTabContext } from "#obsidian/setting-tab/context.ts";
// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  PubSub,
  Queue,
  Stream,
  SubscriptionRef,
} from "effect";
import { TestClock } from "effect/testing";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  ButtonComponent,
  DropdownComponent,
  ExtraButtonComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  ZoteroReadsApi,
  ZoteroReadsEvent,
  ZoteroReadsState,
} from "@zotlit/zotero-reads/client/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";
import type { WebSyncStatus } from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

import {
  databaseFileItem,
  databaseLocationItems,
  refreshReads,
} from "./settings-rows.ts";

import { platformDefaults } from "#__fixtures__/platform-settings.ts";
import { failureOf, recordingRuns } from "#__fixtures__/setting-tab-harness.ts";
import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { LibrarySource } from "#obsidian/library-source/service.ts";
import {
  CREATE_KEY_URL,
  keySecretControl,
  librarySourceItems,
  librarySourceRebuild,
  WEB_API_KEY_CONTROL,
} from "#obsidian/library-source/settings-rows.ts";
import {
  PluginSettings,
  SettingsMutationError,
} from "#obsidian/settings/service.ts";

const SNAPSHOT: ZoteroPrefSnapshot = {
  state: "ready",
  prefs: new Map(),
  resolvedProfileDir: "/home/ada/.zotero/abc.default",
  profileDirOverride: null,
  dataDirOverride: null,
  dataDir: "/home/ada/Zotero",
  databasePath: "/home/ada/Zotero/zotero.sqlite",
  sourceId: "source-1",
  acceptedSourceIds: ["source-1"],
  baseAttachmentPath: null,
  httpPort: null,
};

const PROFILES: ZoteroProfileInfo[] = [
  { dir: "/home/ada/.zotero/abc.default", name: "default", isDefault: true },
  { dir: "/home/ada/.zotero/xyz.thesis", name: "thesis", isDefault: false },
];

const READS: ZoteroReadsState = {
  state: "ready",
  error: null,
  moved: false,
  dbFileMissing: false,
  activeReadMode: "copy",
};

const setup = Effect.fn("setup")(function* (
  refresh: ZoteroReads["Service"]["refresh"] = Effect.void,
  update: PluginSettings["Service"]["update"] = () =>
    Effect.succeed(platformDefaults),
) {
  const pref = yield* SubscriptionRef.make(SNAPSHOT);
  const reads = yield* SubscriptionRef.make(READS);
  const events = yield* PubSub.unbounded<ZoteroReadsEvent>({ replay: 1 });
  const writes: string[] = [];
  const write = (
    field: "profileDirOverride" | "dataDirOverride",
    dir: string | null,
  ) =>
    Effect.sync(() => writes.push(`${field}=${dir}`)).pipe(
      Effect.andThen(
        SubscriptionRef.update(pref, (current) => ({
          ...current,
          [field]: dir,
        })),
      ),
    );
  const services = yield* Layer.build(
    Layer.mergeAll(
      testNotifier().layer,
      Layer.mock(ZoteroPref, {
        current: SubscriptionRef.get(pref),
        changes: SubscriptionRef.changes(pref),
        listProfiles: Effect.succeed(PROFILES),
        setProfileDir: (dir) => write("profileDirOverride", dir),
        setDataDir: (dir) => write("dataDirOverride", dir),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReadsApi>("ZoteroReadsApi", {}),
        current: SubscriptionRef.get(reads),
        changes: SubscriptionRef.changes(reads),
        refresh,
        events: Stream.fromPubSub(events),
      }),
      Layer.mock(PluginSettings, {
        current: Effect.succeed(platformDefaults),
        changes: Stream.empty,
        update,
      }),
    ),
  );
  const { tab, runs } = recordingRuns((yield* scopedSettingTab(services)).tab);
  const ctx = stubService<SettingTabContext>("SettingTabContext", { tab });
  return { ctx, pref, reads, events, writes, runs };
});

const render = Effect.fnUntraced(function* (
  ctx: SettingTabContext,
  id: string,
) {
  const row = [databaseFileItem(ctx), ...databaseLocationItems(ctx)].find(
    (item) => item.id === id,
  );
  if (!row) throw new Error(`Expected a render row: ${id}`);
  const setting = renderRow(row);
  yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
  const dropdown = setting.components.find(
    (control) => control instanceof DropdownComponent,
  );
  const button = setting.components.find(
    (control) => control instanceof ExtraButtonComponent,
  );
  return {
    dropdown,
    button,
    text: () => (setting.desc as unknown as DocumentFragment).textContent,
  };
});

const settle = TestClock.adjust("0 millis");

it.effect(
  "lists the profiles and writes a chosen profile folder through ZoteroPref",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = yield* render(ctx, "settings_db_profile_dir");

      yield* settle;
      expect(row.dropdown?.options.map((option) => option.value)).toEqual([
        "",
        ...PROFILES.map((profile) => profile.dir),
        "\0browse",
      ]);
      expect(row.text()).toContain("/home/ada/.zotero/abc.default/prefs.js");

      row.dropdown!.choose(PROFILES[1]!.dir);
      yield* settle;
      expect(writes).toEqual([`profileDirOverride=${PROFILES[1]!.dir}`]);

      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        state: "loading" as const,
        prefs: new Map(),
      }));
      yield* settle;
      expect(row.text()).toContain(m.settings_db_status_loading());
    }),
);

it.effect(
  "keeps the profile the user chose over a snapshot queued before the choice",
  () =>
    Effect.gen(function* () {
      let current = SNAPSHOT;
      const changes = yield* Queue.unbounded<ZoteroPrefSnapshot>();
      const publish = (next: ZoteroPrefSnapshot) => {
        current = next;
        Queue.offerUnsafe(changes, next);
      };
      publish(SNAPSHOT);
      const services = yield* Layer.build(
        Layer.mock(ZoteroPref, {
          current: Effect.sync(() => current),
          changes: Stream.fromQueue(changes),
          listProfiles: Effect.succeed(PROFILES),
          setProfileDir: (dir) =>
            Effect.sync(() => publish({ ...current, profileDirOverride: dir })),
        }),
      );
      const ctx = stubService<SettingTabContext>("SettingTabContext", {
        tab: (yield* scopedSettingTab(services)).tab,
      });
      const row = yield* render(ctx, "settings_db_profile_dir");

      publish({
        ...current,
        prefs: new Map(),
        profileDirOverride: PROFILES[0]!.dir,
      });
      row.dropdown!.choose(PROFILES[1]!.dir);
      yield* settle;

      expect(row.dropdown?.getValue()).toBe(PROFILES[1]!.dir);
    }),
);

it.effect(
  "writes the data folder override and follows the resolved data folder",
  () =>
    Effect.gen(function* () {
      const { ctx, pref, writes } = yield* setup();
      const row = yield* render(ctx, "settings_db_data_dir");
      yield* settle;
      expect(row.text()).toContain("/home/ada/Zotero");

      yield* SubscriptionRef.update(pref, (current) => ({
        ...current,
        dataDirOverride: "/mnt/library",
        dataDir: "/mnt/library",
      }));
      yield* settle;
      expect(row.text()).toContain("/mnt/library");
      expect(row.dropdown?.getValue()).toBe("/mnt/library");

      row.dropdown!.choose("");
      yield* settle;
      expect(writes).toEqual(["dataDirOverride=null"]);
    }),
);

it.effect("echoes the profile, data folder and Source ID as they move", () =>
  Effect.gen(function* () {
    const { ctx, pref } = yield* setup();
    const row = yield* render(ctx, "settings_db_source_id");
    yield* settle;
    expect(row.text()).toContain("source-1");

    yield* SubscriptionRef.update(pref, (current) => ({
      ...current,
      prefs: new Map(),
      sourceId: "source-2",
    }));
    yield* settle;
    expect(row.text()).toContain("source-2");
  }),
);

it.effect("names the read mode again after the reads change", () =>
  Effect.gen(function* () {
    const { ctx, reads, events } = yield* setup();
    const row = yield* render(ctx, "settings_db_read_mode");
    const named = (mode: () => string) =>
      m.settings_db_active_read_mode({ mode: mode() });
    yield* settle;
    expect(row.text()).toContain(named(m.settings_db_read_mode_copy));

    yield* SubscriptionRef.update(reads, (current) => ({
      ...current,
      activeReadMode: "reflink" as const,
    }));
    yield* PubSub.publish(events, { _tag: "changed" });
    yield* settle;
    expect(row.text()).toContain(named(m.settings_db_read_mode_reflink));
  }),
);

const countedRefresh = (outcome: ZoteroReads["Service"]["refresh"]) => {
  let runs = 0;
  return {
    refresh: Effect.suspend(() => {
      runs += 1;
      return outcome;
    }),
    runs: () => runs,
  };
};

it.effect("refreshes the reads from the database row", () =>
  Effect.gen(function* () {
    const refresh = countedRefresh(Effect.void);
    const { ctx } = yield* setup(refresh.refresh);
    const row = yield* render(ctx, "settings_db_file");
    yield* settle;
    expect(row.text()).toContain("/home/ada/Zotero/zotero.sqlite");

    row.button!.click();
    yield* settle;
    expect(refresh.runs()).toBe(1);
  }),
);

it.effect("fails the read mode save under its label", () =>
  Effect.gen(function* () {
    const patches: unknown[] = [];
    const failure = new SettingsMutationError({
      message: "Settings are read-only",
      cause: null,
    });
    const { ctx, runs } = yield* setup(Effect.void, (patch) =>
      Effect.sync(() => patches.push(patch)).pipe(
        Effect.andThen(Effect.fail(failure)),
      ),
    );
    const row = yield* render(ctx, "settings_db_read_mode");
    yield* settle;

    row.dropdown!.choose("immutable");
    yield* settle;
    expect(patches).toEqual([{ "zotero.read-mode": "immutable" }]);
    expect(runs.map((run) => [failureOf(run), run.label])).toEqual([
      [failure, m.settings_failed_save()],
    ]);
  }),
);

it.effect("runs one refresh when the refresh fails", () =>
  Effect.gen(function* () {
    const refresh = countedRefresh(
      Effect.fail(new DbUnavailable({ message: "zotero.sqlite is locked" })),
    );
    const { ctx } = yield* setup(refresh.refresh);
    const row = yield* render(ctx, "settings_db_file");
    yield* settle;
    expect(row.text()).toContain("/home/ada/Zotero/zotero.sqlite");

    row.button!.click();
    yield* settle;
    expect(refresh.runs()).toBe(1);
  }),
);

const refreshExit = <E>(refresh: Effect.Effect<void, E>) =>
  refreshReads(refresh).pipe(Effect.provide(testNotifier().layer), Effect.exit);

it.effect("fails a refresh with the database's error", () =>
  Effect.gen(function* () {
    const failure = new DbUnavailable({ message: "zotero.sqlite is locked" });
    const exit = yield* refreshExit(Effect.fail(failure));
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(failure);
  }),
);

it.effect("ends a done refresh with no failure", () =>
  Effect.gen(function* () {
    expect(Exit.isSuccess(yield* refreshExit(Effect.void))).toBe(true);
  }),
);

const ONLINE_SYNCING: WebSyncStatus = {
  state: "loading",
  syncing: true,
  waitingForReaders: false,
  problem: null,
  progress: {
    library: { type: "user", id: 42 },
    phase: "items",
    done: 100,
    total: 2500,
  },
  zoteroLocale: "en-US",
  unconsentedUserID: null,
  libraries: [],
};

const setupSource = Effect.fn("setupSource")(function* (
  active: LibrarySourceKind,
) {
  const view = yield* SubscriptionRef.make<LibrarySourceView>({
    selected: active,
    status: active === "file" ? { kind: "file-source" } : { kind: "no-key" },
    actions: { syncNow: false, replace: null, remove: true },
  });
  const show = (
    status: OnlineLibraryStatus,
    actions: LibrarySourceView["actions"] = {
      syncNow: true,
      replace: null,
      remove: true,
    },
  ) =>
    SubscriptionRef.update(view, (before) => ({ ...before, status, actions }));
  const calls: string[] = [];
  let keySecret: string | null = null;
  const services = yield* Layer.build(
    Layer.mergeAll(
      Layer.mock(LibrarySource)({
        active,
        reads: null,
        view: SubscriptionRef.get(view),
        viewChanges: SubscriptionRef.changes(view),
        select: (kind) =>
          Effect.andThen(
            Effect.sync(() => calls.push(`select:${kind}`)),
            SubscriptionRef.update(view, (before) => ({
              ...before,
              selected: kind,
            })),
          ),
        keySecret: Effect.sync(() => keySecret),
        selectKeySecret: (name) =>
          Effect.sync(() => {
            keySecret = name;
            calls.push(`selectKeySecret:${name}`);
          }),
        syncNow: Effect.sync(() => {
          calls.push("syncNow");
        }),
        reload: Effect.sync(() => {
          calls.push("reload");
        }),
        language: Effect.succeed({
          setting: "auto",
          automatic: "en-GB",
          effective: "en-GB",
        }),
      }),
      Layer.succeed(
        ObsidianEnv,
        stubService<ObsidianEnv["Service"]>("ObsidianEnv", {
          language: "en",
        }),
      ),
    ),
  );
  const { tab } = recordingRuns((yield* scopedSettingTab(services)).tab);
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab,
    app: {} as SettingTabContext["app"],
  });
  const [group] = librarySourceItems(ctx) as unknown as [
    { readonly items: SettingDefinitionItem<string>[] },
  ];
  const row = (id: string) => {
    const found = group.items.find(
      (item) => (item as SettingGroupItem<string>).id === id,
    ) as SettingGroupItem<string> | undefined;
    if (!found) throw new Error(`Expected a row: ${id}`);
    return found;
  };
  const visible = (id: string) => {
    const shown = row(id).visible;
    return typeof shown === "function" ? shown() : shown !== false;
  };
  const render = (id: string) =>
    Effect.gen(function* () {
      const setting = renderRow(row(id));
      yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
      yield* TestClock.adjust("0 millis");
      return {
        setting,
        text: () =>
          (setting.desc as unknown as DocumentFragment).textContent ?? "",
      };
    });
  return { show, calls, row, visible, render, services };
});

it.effect(
  "offers the two library sources and asks for a reload after a change",
  () =>
    Effect.gen(function* () {
      const { calls, render, visible } = yield* setupSource("file");
      const { setting } = yield* render("settings_library_source");
      const dropdown = setting.components.find(
        (component) => component instanceof DropdownComponent,
      )!;
      expect(dropdown.options).toEqual([
        { value: "file", label: m.settings_library_source_file() },
        { value: "web-api", label: m.settings_library_source_web_api() },
      ]);
      expect(dropdown.getValue()).toBe("file");
      expect(visible("settings_library_source_reload")).toBe(false);
      expect(visible("settings_online_key")).toBe(false);

      dropdown.choose("web-api");
      yield* TestClock.adjust("0 millis");
      expect(calls).toEqual(["select:web-api"]);
      expect(visible("settings_library_source_reload")).toBe(true);
      expect(visible("settings_online_key")).toBe(true);
      expect(visible("settings_online_language")).toBe(true);
      expect(visible("settings_online_status")).toBe(false);

      const reload = yield* render("settings_library_source_reload");
      (
        reload.setting.components.find(
          (component) => component instanceof ButtonComponent,
        ) as ButtonComponent
      ).click();
      yield* TestClock.adjust("0 millis");
      expect(calls).toEqual(["select:web-api", "reload"]);
    }).pipe(Effect.scoped),
);

it.effect(
  "binds the key row to a secret of Obsidian's keychain, and keeps only the secret's name through the library source",
  () =>
    Effect.gen(function* () {
      const { calls, row, services } = yield* setupSource("web-api");
      const key = row("settings_online_key") as {
        readonly control?: unknown;
        readonly desc?: DocumentFragment;
      };
      expect(key.control).toEqual({
        type: "secret",
        key: WEB_API_KEY_CONTROL,
      });
      expect(key.desc?.textContent).toContain(m.settings_online_key_create());
      expect(key.desc?.querySelector("a")?.getAttribute("href")).toBe(
        CREATE_KEY_URL,
      );
      expect(keySecretControl.claims(WEB_API_KEY_CONTROL)).toBe(true);
      expect(
        yield* keySecretControl
          .read(WEB_API_KEY_CONTROL)
          .pipe(Effect.provideContext(services)),
      ).toBe("");
      yield* keySecretControl
        .write(WEB_API_KEY_CONTROL, "zotero-reading-key")
        .pipe(Effect.provideContext(services));
      expect(calls).toEqual(["selectKeySecret:zotero-reading-key"]);
      expect(
        yield* keySecretControl
          .read(WEB_API_KEY_CONTROL)
          .pipe(Effect.provideContext(services)),
      ).toBe("zotero-reading-key");
    }).pipe(Effect.scoped),
);

it.effect(
  "redraws the settings when the online library returns to no key, so the key row shows the cleared secret at once",
  () =>
    Effect.gen(function* () {
      const { show, services } = yield* setupSource("web-api");
      const rebuilds = yield* Queue.unbounded<string>();
      yield* (yield* librarySourceRebuild.pipe(
        Effect.provideContext(services),
      )).pipe(
        Stream.runForEach((signal) => Queue.offer(rebuilds, signal)),
        Effect.forkScoped,
      );
      yield* TestClock.adjust("0 millis");
      yield* show({
        kind: "running",
        sync: {
          ...ONLINE_SYNCING,
          syncing: false,
          progress: null,
          state: "ready",
        },
        account: "ada",
        serverSchemaVersion: null,
      });
      yield* TestClock.adjust("0 millis");
      const before = yield* Queue.size(rebuilds);
      yield* show({ kind: "no-key" });
      yield* TestClock.adjust("0 millis");
      expect((yield* Queue.size(rebuilds)) - before).toBe(1);
    }).pipe(Effect.scoped),
);

it.effect("names the account that Zotero accepted for the key", () =>
  Effect.gen(function* () {
    const { render, show } = yield* setupSource("web-api");
    const { text } = yield* render("settings_online_status");
    yield* show({
      kind: "running",
      sync: {
        ...ONLINE_SYNCING,
        syncing: false,
        progress: null,
        state: "ready",
      },
      account: "ada",
      serverSchemaVersion: null,
    });
    yield* TestClock.adjust("0 millis");
    expect(text()).toContain(
      m.settings_online_key_accepted({ username: "ada" }),
    );
  }).pipe(Effect.scoped),
);

it.effect("shows the state of the online library and syncs on Sync now", () =>
  Effect.gen(function* () {
    const { calls, render, show, visible } = yield* setupSource("web-api");
    expect(visible("settings_online_status")).toBe(true);
    expect(visible("settings_online_replace")).toBe(false);
    const { setting, text } = yield* render("settings_online_status");
    expect(text()).toBe(m.settings_online_status_no_key());

    yield* show({
      kind: "running",
      sync: ONLINE_SYNCING,
      account: null,
      serverSchemaVersion: null,
    });
    yield* TestClock.adjust("0 millis");
    expect(text()).toBe(
      m.settings_online_status_items({ done: 100, total: 2500 }),
    );

    yield* show({
      kind: "pack",
      refusal: { kind: "pack-outdated" },
    });
    yield* TestClock.adjust("0 millis");
    expect(text()).toBe(m.settings_resource_pack_status_pack_outdated());

    (
      setting.components.find(
        (component) => component instanceof ButtonComponent,
      ) as ButtonComponent
    ).click();
    yield* TestClock.adjust("0 millis");
    expect(calls).toEqual(["syncNow"]);

    const accountChanged: OnlineLibraryStatus = {
      kind: "running",
      sync: {
        ...ONLINE_SYNCING,
        syncing: false,
        progress: null,
        state: "degraded",
        problem: {
          _tag: "account-changed",
          message: "",
          consentedUserID: 1,
          storedUserID: 1,
          keyUserID: 2,
        },
      },
      account: null,
      serverSchemaVersion: null,
    };
    yield* show(accountChanged);
    expect(visible("settings_online_replace")).toBe(false);
    yield* show(accountChanged, { syncNow: true, replace: 2, remove: true });
    expect(visible("settings_online_replace")).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect(
  "lists Automatic with the resolved language, then each language of Zotero by name",
  () =>
    Effect.gen(function* () {
      const { row } = yield* setupSource("web-api");
      const language = row("settings_online_language") as {
        readonly control?: unknown;
      };
      expect(language.control).toMatchObject({
        type: "dropdown",
        key: "zotero.language",
      });
      const options = (
        language.control as { readonly options: Record<string, string> }
      ).options;
      expect(options["auto"]).toBe(
        m.settings_online_language_automatic({
          language: "British English",
        }),
      );
      expect(options["de"]).toBe("German");
      expect(options["en-US"]).toBe("American English");
    }).pipe(Effect.scoped),
);
