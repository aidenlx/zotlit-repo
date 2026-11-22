import type {} from "#core/database/settings.ts";
import type {
  ZoteroPrefSnapshot,
  ZoteroProfileInfo,
} from "#core/zotero-pref/service.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect, Stream } from "effect";
import { join } from "node:path";
import type {
  DropdownComponent,
  ExtraButtonComponent,
  Setting,
  SettingGroupItem,
} from "obsidian";

import { companionDocsUrl, docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { withProgress } from "@zotlit/obsidian-kit/notifier.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  changed,
  degraded,
  refreshFailed,
  refreshing,
} from "@zotlit/zotero-reads/client/events.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsState } from "@zotlit/zotero-reads/client/service.ts";
import type {
  ConfiguredReadMode,
  EffectiveReadMode,
} from "@zotlit/zotero-reads/contract/rpc.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";
import {
  appendDeviceOverrideNote,
  browseForDir,
} from "#desktop/setting-tab/device-override.ts";
import { PREFS_FILENAME } from "#desktop/zotero-pref/prefs-file.ts";
import { paintEach } from "#obsidian/setting-tab/effect-tab.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const PICKER_AUTO = "";
const PICKER_BROWSE = "\0browse";

export function databaseFileItem(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_db_file",
    name: m.settings_db_file_name(),
    desc: m.settings_db_file_desc(),
    render: (setting) => renderDatabaseFileRow(setting, ctx),
  };
}

export function databaseSyncItems(
  liveUpdates: SettingGroupItem<SettingsKey>[],
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_db_companion",
      name: m.settings_db_companion_name(),
      desc: m.settings_db_companion_desc(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_db_companion_install())
            .onClick(() => window.open(companionDocsUrl())),
        );
      },
    },
    ...liveUpdates,
    {
      id: "settings_db_auto_refresh",
      name: m.settings_db_auto_refresh_name(),
      desc: m.settings_db_auto_refresh_desc(),
      control: { type: "toggle", key: "zotero.auto-refresh" },
    },
    {
      id: "settings_db_stale_help",
      name: m.settings_db_stale_help_name(),
      desc: m.settings_db_stale_help_desc(),
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_db_stale_help_action())
            .onClick(() => window.open(docsUrl("/docs/how-to/fix-stale-data"))),
        );
      },
    },
  ];
}

export function databaseLocationItems(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey>[] {
  return [
    {
      id: "settings_db_profile_dir",
      name: m.settings_db_profile_dir_name(),
      desc: m.settings_db_profile_dir_desc(),
      render: (setting) => renderProfileDirRow(setting, ctx),
    },
    {
      id: "settings_db_data_dir",
      name: m.settings_db_data_dir_name(),
      desc: m.settings_db_data_dir_desc(),
      render: (setting) => renderDataDirRow(setting, ctx),
    },
    {
      id: "settings_db_read_mode",
      name: m.settings_db_read_mode_name(),
      desc: m.settings_db_read_mode_desc(),
      render: (setting) => renderReadModeRow(setting, ctx),
    },
    {
      id: "settings_db_source_id",
      name: m.settings_db_source_id_name(),
      desc: m.settings_db_source_id_desc(),
      render: (setting) => renderSourceIdRow(setting, ctx),
    },
  ];
}

interface DatabaseFileStatus {
  readonly state: ZoteroReadsState["state"];
  readonly refreshing: boolean;
  readonly refreshFailed: boolean;
  readonly errorMessage: string | null;
}

export const refreshReads = <E>(refresh: Effect.Effect<void, E>) =>
  withProgress(refresh, {
    loading: m.notice_db_refreshing(),
    success: m.notice_db_refreshed(),
    error: m.notice_db_refresh_failed(),
  });

function renderDatabaseFileRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_file_desc());
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);
  const statusBr = createEl("br");
  const statusSpan = createSpan();
  statusBr.classList.add("zt:hidden");
  statusSpan.classList.add("zt:hidden");
  desc.append(statusBr, statusSpan);

  let refreshButton: ExtraButtonComponent | undefined;
  setting.setDesc(desc).addExtraButton((button) => {
    refreshButton = button
      .setIcon("refresh-cw")
      .setTooltip(m.settings_db_refresh());
  });

  const paintStatus = (status: DatabaseFileStatus): void => {
    const text =
      status.state === "loading"
        ? m.settings_db_status_loading()
        : status.refreshing
          ? m.settings_db_status_refreshing()
          : status.state === "degraded"
            ? m.settings_db_status_degraded()
            : status.refreshFailed
              ? m.settings_db_status_refresh_failed()
              : "";
    const isError =
      !status.refreshing &&
      status.state !== "loading" &&
      (status.state === "degraded" || status.refreshFailed);
    statusBr.classList.toggle("zt:hidden", !text);
    statusSpan.classList.toggle("zt:hidden", !text);
    statusSpan.textContent = text;
    statusSpan.classList.toggle("mod-warning", Boolean(text) && isError);
    statusSpan.ariaLabel = text ? (status.errorMessage ?? "") : null;
    refreshButton?.setDisabled(status.state === "loading" || status.refreshing);
  };

  return ctx.tab.mount(
    Effect.gen(function* () {
      const reads = yield* ZoteroReads;
      const pref = yield* ZoteroPref;
      const refresh = refreshReads(reads.refresh).pipe(Effect.ignore);

      refreshButton?.onClick(() => void ctx.tab.run(refresh));

      const initial = yield* reads.current;
      const status = Stream.mergeAll(
        [
          reads.changes.pipe(
            Stream.map(
              ({ state }) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  state,
                }),
            ),
          ),
          changed(reads).pipe(
            Stream.map(
              () =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshFailed: false,
                  errorMessage: null,
                }),
            ),
          ),
          degraded(reads).pipe(
            Stream.map(
              (error) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  errorMessage: extractErrorMessage(error),
                }),
            ),
          ),
          refreshFailed(reads).pipe(
            Stream.map(
              (error) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshFailed: true,
                  errorMessage: extractErrorMessage(error),
                }),
            ),
          ),
          refreshing(reads).pipe(
            Stream.map(
              (active) =>
                (current: DatabaseFileStatus): DatabaseFileStatus => ({
                  ...current,
                  refreshing: active,
                }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Stream.scan(
          (): DatabaseFileStatus => ({
            state: initial.state,
            refreshing: false,
            refreshFailed: false,
            errorMessage:
              initial.state === "degraded" && initial.error
                ? extractErrorMessage(initial.error)
                : null,
          }),
          (
            current,
            step: (current: DatabaseFileStatus) => DatabaseFileStatus,
          ) => step(current),
        ),
      );
      const path = pref.changes.pipe(
        Stream.map((snapshot) => snapshot.databasePath),
        Stream.changes,
      );
      yield* Effect.all(
        [
          paintEach(status, paintStatus),
          paintEach(path, (databasePath) => {
            pathCode.textContent = databasePath;
          }),
        ],
        { concurrency: "unbounded", discard: true },
      );
    }),
  );
}

function renderReadModeRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_read_mode_desc());
  const options = createEl("ul");
  for (const [name, details] of [
    [m.settings_db_read_mode_reflink(), m.settings_db_read_mode_reflink_desc()],
    [m.settings_db_read_mode_copy(), m.settings_db_read_mode_copy_desc()],
    [
      m.settings_db_read_mode_immutable(),
      m.settings_db_read_mode_immutable_desc(),
    ],
  ] as const) {
    const item = createEl("li");
    item.append(`${name}: ${details}`);
    options.append(item);
  }
  desc.append(options);
  desc.append(createEl("br"));
  const activeMode = createSpan();
  desc.append(activeMode);

  const modeLabel = (mode: ConfiguredReadMode | EffectiveReadMode): string => {
    switch (mode) {
      case "auto":
        return m.settings_db_read_mode_auto();
      case "reflink":
        return m.settings_db_read_mode_reflink();
      case "copy":
        return m.settings_db_read_mode_copy();
      case "immutable":
        return m.settings_db_read_mode_immutable();
    }
  };

  const applyActiveMode = (mode: EffectiveReadMode | null): void => {
    activeMode.textContent = mode
      ? m.settings_db_active_read_mode({ mode: modeLabel(mode) })
      : "";
  };

  setting.setDesc(desc).addDropdown((dropdown) => {
    dropdown
      .addOption("auto", modeLabel("auto"))
      .addOption("reflink", modeLabel("reflink"))
      .addOption("copy", modeLabel("copy"))
      .addOption("immutable", modeLabel("immutable"))
      .setValue(ctx.tab.sync(currentSettings)["zotero.read-mode"])
      .onChange((value) => {
        void ctx.tab.run(
          PluginSettings.use((settings) =>
            settings.update({
              "zotero.read-mode": value as ConfiguredReadMode,
            }),
          ),
          m.settings_failed_save(),
        );
      });
  });

  return ctx.tab.mount(
    Effect.gen(function* () {
      const reads = yield* ZoteroReads;
      const activeReadMode = Effect.map(
        reads.current,
        (state) => state.activeReadMode,
      );
      applyActiveMode(yield* activeReadMode);
      yield* paintEach(
        reads.events.pipe(
          Stream.filter(
            (event) =>
              event._tag === "changed" ||
              event._tag === "degraded" ||
              event._tag === "refresh-failed",
          ),
          Stream.mapEffect(() => activeReadMode),
        ),
        applyActiveMode,
      );
    }),
  );
}

function renderProfileDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_profile_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);
  const statusBr = createEl("br");
  const statusSpan = createSpan();
  statusBr.classList.add("zt:hidden");
  statusSpan.classList.add("zt:hidden");
  desc.append(statusBr, statusSpan);

  let dropdown: DropdownComponent | undefined;
  let profiles: readonly ZoteroProfileInfo[] = [];

  const selectedValue = (snapshot: ZoteroPrefSnapshot): string =>
    snapshot.profileDirOverride ?? PICKER_AUTO;
  const setProfileDir = (dir: string | null): void =>
    void ctx.tab.run(
      ZoteroPref.use((pref) => pref.setProfileDir(dir)),
      m.settings_failed_db_profile_dir(),
    );

  const repopulate = (current: string): void => {
    if (!dropdown) return;
    dropdown.selectEl.replaceChildren();
    dropdown.addOption(PICKER_AUTO, m.settings_db_profile_auto());
    for (const p of profiles) dropdown.addOption(p.dir, profileLabel(p));
    if (current !== PICKER_AUTO && !profiles.some((p) => p.dir === current)) {
      dropdown.addOption(current, current);
    }
    dropdown.addOption(PICKER_BROWSE, m.settings_db_profile_browse());
    dropdown.setValue(current);
  };

  setting.setDesc(desc).addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      if (value === PICKER_BROWSE) {
        const snapshot = ctx.tab.sync(currentPref);
        d.setValue(selectedValue(snapshot));
        void ctx.tab.run(
          Effect.gen(function* () {
            const pref = yield* ZoteroPref;
            const startPath =
              snapshot.profileDirOverride ?? (yield* pref.profilesRoot);
            yield* Effect.promise(() =>
              browseForDir({
                title: m.settings_db_profile_dir_dialog_title(),
                startPath,
                onPick: setProfileDir,
              }),
            );
          }),
          m.settings_failed_db_profile_dir(),
        );
      } else if (value === PICKER_AUTO) {
        setProfileDir(null);
      } else {
        setProfileDir(value);
      }
    });
    repopulate(selectedValue(ctx.tab.sync(currentPref)));
  });

  const applyStatus = (snapshot: ZoteroPrefSnapshot): void => {
    const dir = snapshot.resolvedProfileDir;
    pathCode.textContent = dir ? join(dir, PREFS_FILENAME) : "";

    const state = snapshot.state;
    const text =
      state === "loading"
        ? m.settings_db_status_loading()
        : state === "degraded"
          ? m.settings_db_profile_status_degraded()
          : "";
    if (text) {
      statusBr.classList.remove("zt:hidden");
      statusSpan.classList.remove("zt:hidden");
      statusSpan.textContent = text;
      statusSpan.classList.toggle("mod-warning", state === "degraded");
    } else {
      statusBr.classList.add("zt:hidden");
      statusSpan.classList.add("zt:hidden");
      statusSpan.textContent = "";
      statusSpan.classList.remove("mod-warning");
    }
  };

  return ctx.tab.mount(
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const loadProfiles = Effect.gen(function* () {
        profiles = yield* pref.listProfiles;
        repopulate(selectedValue(yield* pref.current));
      });
      const prefsChanges = paintEach(
        pref.changes.pipe(
          Stream.changesWith((a, b) => a.prefs === b.prefs),
          Stream.mapEffect(() => pref.current),
        ),
        (snapshot) => {
          applyStatus(snapshot);
          const current = selectedValue(snapshot);
          if (dropdown && dropdown.getValue() !== current) repopulate(current);
        },
      );
      yield* Effect.all([loadProfiles, prefsChanges], {
        concurrency: "unbounded",
        discard: true,
      });
    }),
  );
}

function profileLabel(p: ZoteroProfileInfo): string {
  const name = p.name ?? m.settings_db_profile_unnamed();
  return p.isDefault ? m.settings_db_profile_default({ name }) : name;
}

function extractErrorMessage(err: Error): string {
  const cause = err.cause;
  if (cause instanceof Error) return cause.message;
  return err.message;
}

function renderDataDirRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_data_dir_desc());
  appendDeviceOverrideNote(desc);
  desc.append(createEl("br"));
  const pathCode = createEl("code");
  desc.append(pathCode);

  let dropdown: DropdownComponent | undefined;

  const selectedValue = (snapshot: ZoteroPrefSnapshot): string =>
    snapshot.dataDirOverride ?? PICKER_AUTO;
  const setDataDir = (dir: string | null): void =>
    void ctx.tab.run(
      ZoteroPref.use((pref) => pref.setDataDir(dir)),
      m.settings_failed_db_data_dir(),
    );

  const repopulate = (current: string): void => {
    if (!dropdown) return;
    dropdown.selectEl.replaceChildren();
    dropdown.addOption(PICKER_AUTO, m.settings_db_data_dir_auto());
    if (current !== PICKER_AUTO) dropdown.addOption(current, current);
    dropdown.addOption(PICKER_BROWSE, m.settings_db_profile_browse());
    dropdown.setValue(current);
  };

  setting.setDesc(desc).addDropdown((d) => {
    dropdown = d;
    d.onChange((value) => {
      if (value === PICKER_BROWSE) {
        const snapshot = ctx.tab.sync(currentPref);
        d.setValue(selectedValue(snapshot));
        void browseForDir({
          title: m.settings_db_data_dir_dialog_title(),
          startPath: snapshot.dataDirOverride ?? undefined,
          onPick: setDataDir,
        });
      } else if (value === PICKER_AUTO) {
        setDataDir(null);
      } else {
        setDataDir(value);
      }
    });
    repopulate(selectedValue(ctx.tab.sync(currentPref)));
  });

  return ctx.tab.mount(
    ZoteroPref.use((pref) =>
      paintEach(pathChanges(pref), (snapshot) => {
        pathCode.textContent = snapshot.dataDir;
        const current = selectedValue(snapshot);
        if (dropdown && dropdown.getValue() !== current) repopulate(current);
      }),
    ),
  );
}

function renderSourceIdRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  desc.append(m.settings_db_source_id_desc());
  const profileLine = appendLabeledCode(
    desc,
    m.settings_db_source_id_profile(),
  );
  const dataLine = appendLabeledCode(desc, m.settings_db_source_id_data());
  const idLine = appendLabeledCode(desc, m.settings_db_source_id_value());

  setting.setDesc(desc);

  return ctx.tab.mount(
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const settings = yield* PluginSettings;
      yield* paintEach(
        Stream.merge(
          pathChanges(pref),
          settings.changes.pipe(Stream.mapEffect(() => pref.current)),
        ),
        (snapshot) => {
          profileLine.textContent = snapshot.resolvedProfileDir ?? "—";
          dataLine.textContent = snapshot.dataDir;
          idLine.textContent = snapshot.sourceId ?? "—";
        },
      );
    }),
  );
}

const currentPref = ZoteroPref.use((pref) => pref.current);

const currentSettings = PluginSettings.use((settings) => settings.current);

export const zoteroDataDir = Effect.map(
  currentPref,
  (snapshot) => snapshot.dataDir,
);

const pathChanges = (pref: Pick<ZoteroPref["Service"], "changes">) =>
  pref.changes.pipe(
    Stream.changesWith(
      (a, b) => a.prefs === b.prefs && a.dataDirOverride === b.dataDirOverride,
    ),
  );

function appendLabeledCode(frag: DocumentFragment, label: string): HTMLElement {
  frag.append(createEl("br"));
  frag.append(label);
  const code = createEl("code");
  frag.append(" ", code);
  return code;
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    ZoteroPref: ZoteroPref;
    ZoteroReads: ZoteroReads;
  }
}
