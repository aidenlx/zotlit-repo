import * as m from "@zotlit/plugin-messages/messages.ts";

import type { LanguagePackSituation } from "./service.ts";

export type LanguagePackSettingCopy = {
  name: string;
  desc: string;
  install?: {
    label: string;
    disabled: boolean;
    run(): void;
  };
};

export function languagePackSettingCopy(lifecycle: {
  readonly plugin: string;
  readonly endonym: string;
  readonly situation: LanguagePackSituation;
  install(): void;
}): LanguagePackSettingCopy | undefined {
  const { plugin, endonym, situation } = lifecycle;
  const name = m.settings_language_pack_name();
  const install = (disabled: boolean): LanguagePackSettingCopy["install"] => ({
    label: m.notice_language_pack_install_action(),
    disabled,
    run: () => lifecycle.install(),
  });

  switch (situation.kind) {
    case "unavailable":
    case "active":
      return undefined;
    case "restart-pending":
      return { name, desc: m.notice_language_pack_restart({ plugin }) };
    case "downloading":
      return {
        name,
        desc: m.notice_language_pack_downloading({ plugin }),
        install: install(true),
      };
    case "offered":
    case "installable":
      return {
        name,
        desc: m.settings_language_pack_desc({ plugin, language: endonym }),
        install: install(false),
      };
  }
}
