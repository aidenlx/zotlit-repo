import type {} from "#core/database/settings.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect, Option, Stream } from "effect";
import type {
  ButtonComponent,
  Setting,
  SettingDefinitionItem,
  SettingDefinitionList,
  SettingGroupItem,
} from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { toInstant } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZOTERO_LOCALES } from "@zotlit/zotero-compat";

import type {
  LibrarySourceKind,
  LibrarySourceView,
  OtherDataScope,
  OtherDataView,
} from "./service.ts";
import { LibrarySource } from "./service.ts";
import type { OnlineLibraryStatus } from "./status.ts";
import { formatSyncTime, isProblem, statusText } from "./status.ts";
import type { StoredReplicaFolder } from "./stored-replica.ts";

import { AUTOMATIC_ZOTERO_LANGUAGE } from "#core/database/settings.ts";
import { paintEach } from "#obsidian/setting-tab/effect-tab.ts";

export const CREATE_KEY_URL = "https://www.zotero.org/settings/keys/new";

const source = Effect.map(LibrarySource, (service) => service);

export const librarySourceRebuild = Effect.map(LibrarySource, (service) =>
  service.viewChanges.pipe(
    Stream.map(
      ({ selected, actions, status }) =>
        `${selected}:${actions.replace !== null}:${status.kind === "no-key"}`,
    ),
    Stream.changes,
    Stream.drop(1),
  ),
);

export function fileSourceActive(ctx: SettingTabContext): boolean {
  return Option.match(ctx.tab.sync(Effect.serviceOption(LibrarySource)), {
    onNone: () => true,
    onSome: (service) => service.active === "file",
  });
}

function sourceItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_library_source",
    name: m.settings_library_source_name(),
    desc: m.settings_library_source_desc(),
    render: (setting) => {
      const desc = createFragment();
      desc.append(m.settings_library_source_desc());
      desc.append(createEl("br"));
      desc.append(
        createEl("small", { text: m.settings_db_device_override_note() }),
      );
      setting.setDesc(desc).addDropdown((dropdown) => {
        dropdown
          .addOption("file", m.settings_library_source_file())
          .addOption("web-api", m.settings_library_source_web_api())
          .setValue(
            ctx.tab.sync(
              Effect.flatMap(source, (s) =>
                Effect.map(s.view, (view) => view.selected),
              ),
            ),
          )
          .onChange((value) => {
            void ctx.tab.run(
              Effect.flatMap(source, (s) =>
                s.select(value as LibrarySourceKind),
              ),
              m.settings_failed_library_source(),
            );
          });
      });
    },
  };
}

export const WEB_API_KEY_CONTROL = "zotlit.online-library-key";

export const keySecretControl = {
  claims: (key: string) => key === WEB_API_KEY_CONTROL,
  read: (_key: string) =>
    Effect.flatMap(source, (service) =>
      Effect.map(service.keySecret, (name) => name ?? ""),
    ),
  write: (_key: string, value: unknown) =>
    Effect.flatMap(source, (service) =>
      service.selectKeySecret(typeof value === "string" ? value : null),
    ),
};

function keyItem(): SettingGroupItem<SettingsKey> {
  const desc = createFragment();
  desc.append(m.settings_online_key_desc(), " ");
  desc.append(
    createEl("a", {
      text: m.settings_online_key_create(),
      href: CREATE_KEY_URL,
    }),
  );
  return {
    id: "settings_online_key",
    name: m.settings_online_key_name(),
    desc,
    control: {
      type: "secret",
      key: WEB_API_KEY_CONTROL as SettingsKey,
    },
  };
}

function acceptedAccount(status: OnlineLibraryStatus): string | null {
  return status.kind === "running" &&
    status.account !== null &&
    status.sync.problem?._tag !== "key-invalid" &&
    status.sync.problem?._tag !== "no-access"
    ? status.account
    : null;
}

function statusItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_online_status",
    name: m.settings_online_status_name(),
    render: (setting) => renderStatusRow(setting, ctx),
  };
}

function renderStatusRow(setting: Setting, ctx: SettingTabContext): () => void {
  const text = createSpan();
  const accepted = createSpan();
  const acceptedBreak = createEl("br");
  const desc = createFragment();
  desc.append(text, acceptedBreak, accepted);
  let button: ButtonComponent | undefined;
  setting.setDesc(desc).addButton((b) => {
    button = b
      .setButtonText(m.settings_online_sync_now())
      .setCta()
      .onClick(
        () =>
          void ctx.tab.run(
            Effect.flatMap(source, (s) =>
              s.syncNow.pipe(
                Effect.catchTag("UserCancelled", () => Effect.void),
              ),
            ),
            m.settings_failed_online_sync(),
          ),
      );
  });
  const paint = ({ status, actions }: LibrarySourceView) => {
    text.textContent = statusText(status, formatSyncTime);
    const account = acceptedAccount(status);
    accepted.textContent = account
      ? m.settings_online_key_accepted({ username: account })
      : "";
    acceptedBreak.classList.toggle("zt:hidden", !account);
    accepted.classList.toggle("zt:hidden", !account);
    text.classList.toggle("mod-warning", isProblem(status));
    button?.setDisabled(!actions.syncNow);
  };
  return ctx.tab.mount(
    Effect.flatMap(source, (service) => paintEach(service.viewChanges, paint)),
  );
}

function replaceItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_online_replace",
    name: m.settings_online_replace_name(),
    desc: m.settings_online_replace_desc(),
    visible: () =>
      ctx.tab.sync(
        Effect.flatMap(source, (s) =>
          Effect.map(s.view, (view) => view.actions.replace !== null),
        ),
      ),
    render: (setting) => {
      const shown = ctx.tab.sync(
        Effect.flatMap(source, (s) =>
          Effect.map(s.view, (view) => view.actions.replace),
        ),
      );
      setting.addButton((b) =>
        b
          .setButtonText(m.settings_online_replace_action())
          .setWarning()
          .onClick(
            () =>
              void ctx.tab.run(
                Effect.flatMap(source, (s) =>
                  shown === null ? Effect.void : s.replaceData(shown),
                ),
                m.settings_failed_online_sync(),
              ),
          ),
      );
    },
  };
}

function languageItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  const { language } = ctx.tab.sync(Effect.map(ObsidianEnv, (env) => env));
  const names = new Intl.DisplayNames([language, "en"], { type: "language" });
  const name = (locale: string) => names.of(locale) ?? locale;
  const { automatic } = ctx.tab.sync(Effect.flatMap(source, (s) => s.language));
  const options: Record<string, string> = {
    [AUTOMATIC_ZOTERO_LANGUAGE]: m.settings_online_language_automatic({
      language: name(automatic),
    }),
  };
  for (const locale of [...ZOTERO_LOCALES].sort((a, b) =>
    name(a).localeCompare(name(b), language),
  ))
    options[locale] = name(locale);
  return {
    id: "settings_online_language",
    name: m.settings_online_language_name(),
    desc: m.settings_online_language_desc(),
    control: { type: "dropdown", key: "zotero.language", options },
  };
}

function confirmRemoveData(ctx: SettingTabContext): void {
  void ctx.tab.run(
    Effect.gen(function* () {
      const confirmed = yield* awaitConfirm(
        {
          title: m.modal_online_remove_title(),
          content: m.modal_online_remove_content(),
          action: m.modal_online_remove_action(),
          cancel: m.modal_online_remove_cancel(),
          destructive: true,
        },
        ctx.app,
      );
      if (confirmed) yield* (yield* source).removeData;
    }),
    m.settings_failed_online_remove(),
  );
}

function removeItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_online_remove",
    name: m.settings_online_remove_name(),
    desc: m.settings_online_remove_desc(),
    action: () => confirmRemoveData(ctx),
  };
}

function reloadItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_library_source_reload",
    name: m.settings_library_source_reload_name(),
    desc: m.settings_library_source_reload_desc(),
    visible: () =>
      ctx.tab.sync(
        Effect.flatMap(source, (s) =>
          Effect.map(s.view, (view) => view.selected !== s.active),
        ),
      ),
    render: (setting) => {
      setting.addButton((b) =>
        b
          .setButtonText(m.settings_library_source_reload_action())
          .setCta()
          .onClick(
            () => void ctx.tab.run(Effect.flatMap(source, (s) => s.reload)),
          ),
      );
    },
  };
}

const otherData = Effect.flatMap(source, (s) => s.otherData);

const otherDataKey = (data: OtherDataView): string =>
  data.kind === "listed"
    ? JSON.stringify([
        data.scope,
        data.folders.map(({ id, bytes, changed }) => [
          id,
          bytes,
          changed?.epochMilliseconds ?? null,
        ]),
      ])
    : data.kind === "unreadable"
      ? `unreadable:${data.message}`
      : "unread";

export const onlineLibraryDataRebuild = Effect.map(LibrarySource, (service) =>
  service.otherDataChanges.pipe(
    Stream.map((data) => otherDataKey(data)),
    Stream.changes,
    Stream.drop(1),
  ),
);

function dataSize(bytes: number): string {
  const [unit, size] =
    bytes >= 1e9
      ? (["gigabyte", bytes / 1e9] as const)
      : bytes >= 1e6
        ? (["megabyte", bytes / 1e6] as const)
        : (["kilobyte", bytes / 1e3] as const);
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  }).format(size);
}

function folderDesc({ bytes, changed }: StoredReplicaFolder): string {
  const size = dataSize(bytes);
  return changed
    ? m.settings_online_data_folder_desc({
        size,
        changed: formatSyncTime(toInstant(changed)),
      })
    : size;
}

function othersDesc(data: OtherDataView): string | DocumentFragment {
  if (data.kind === "listed")
    return data.scope === "gone-vaults"
      ? m.settings_online_data_others_gone_desc()
      : m.settings_online_data_others_shared_desc();
  if (data.kind === "unread") return m.settings_online_data_others_reading();
  const desc = createFragment();
  desc.append(createSpan({ cls: "mod-warning", text: data.message }));
  return desc;
}

function confirmRemoveOther(
  ctx: SettingTabContext,
  scope: OtherDataScope,
  folder: StoredReplicaFolder,
): void {
  void ctx.tab.run(
    Effect.gen(function* () {
      const confirmed = yield* awaitConfirm(
        {
          title: m.modal_online_data_remove_title({ id: folder.id }),
          content:
            scope === "gone-vaults"
              ? m.modal_online_data_remove_gone_content()
              : m.modal_online_data_remove_shared_content(),
          action: m.modal_online_remove_action(),
          cancel: m.modal_online_remove_cancel(),
          destructive: true,
        },
        ctx.app,
      );
      if (confirmed) yield* (yield* source).removeOtherData(folder.id);
    }),
    m.settings_failed_online_remove(),
  );
}

export function onlineLibraryDataItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const data = ctx.tab.sync(otherData);
  const list: SettingDefinitionList<SettingsKey> = {
    type: "list",
    id: "settings_online_data_list",
    emptyState:
      data.kind === "listed"
        ? m.settings_online_data_others_empty()
        : data.kind === "unread"
          ? m.settings_online_data_others_reading()
          : data.message,
    ...(data.kind === "listed" && {
      onDelete: (index: number) => {
        const folder = data.folders[index];
        if (folder) confirmRemoveOther(ctx, data.scope, folder);
      },
    }),
    items:
      data.kind === "listed"
        ? data.folders.map((folder) => ({
            id: `settings_online_data_folder:${folder.id}`,
            name: folder.id,
            desc: folderDesc(folder),
            searchable: false,
          }))
        : [],
  };
  return [
    {
      type: "group",
      id: "settings_online_data",
      heading: m.settings_online_data_heading(),
      items: [
        {
          id: "settings_online_data_this",
          name: m.settings_online_data_this_name(),
          desc: m.settings_online_remove_desc(),
          action: () => confirmRemoveData(ctx),
        },
        {
          id: "settings_online_data_others",
          name: m.settings_online_data_others_name(),
          desc: othersDesc(data),
          render: () =>
            ctx.tab.mount(Effect.flatMap(source, (s) => s.readOtherData)),
        },
      ],
    },
    list,
  ];
}

export function librarySourceItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsKey>[] {
  const shown = (item: SettingGroupItem<SettingsKey>) =>
    typeof item.visible === "function"
      ? item.visible()
      : item.visible !== false;
  const when =
    (test: (service: LibrarySource["Service"]) => Effect.Effect<boolean>) =>
    (item: SettingGroupItem<SettingsKey>) =>
      ({
        ...item,
        visible: () =>
          ctx.tab.sync(Effect.flatMap(source, (service) => test(service))) &&
          shown(item),
      }) as SettingGroupItem<SettingsKey>;
  const online = when((s) =>
    Effect.map(s.view, (view) => view.selected === "web-api"),
  );
  const running = (item: SettingGroupItem<SettingsKey>) =>
    online(when((s) => Effect.succeed(s.active === "web-api"))(item));
  return [
    {
      type: "group",
      id: "settings_library_source_group",
      heading: m.settings_library_source_heading(),
      items: [
        sourceItem(ctx),
        reloadItem(ctx),
        online(keyItem()),
        running(statusItem(ctx)),
        running(replaceItem(ctx)),
        online(languageItem(ctx)),
        online(removeItem(ctx)),
      ],
    },
  ];
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LibrarySource: LibrarySource;
    ObsidianEnv: ObsidianEnv;
  }
}
