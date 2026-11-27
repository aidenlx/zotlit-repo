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
  SettingGroupItem,
} from "obsidian";

import { awaitConfirm } from "@zotlit/obsidian-kit/confirm.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZOTERO_LOCALES } from "@zotlit/zotero-compat";

import { LibrarySource } from "./service.ts";
import type { LibrarySourceKind, LibrarySourceView } from "./service.ts";
import { formatSyncTime, isProblem, statusText } from "./status.ts";
import type { OnlineLibraryStatus } from "./status.ts";

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
            Effect.flatMap(source, (s) => s.syncNow),
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

function removeItem(ctx: SettingTabContext): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_online_remove",
    name: m.settings_online_remove_name(),
    desc: m.settings_online_remove_desc(),
    action: () =>
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
      ),
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
