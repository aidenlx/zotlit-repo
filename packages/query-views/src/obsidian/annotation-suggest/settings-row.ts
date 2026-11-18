// The Citations page's Annotation trigger row, in a build with the
// Annotation Suggester.
import type { SettingGroupItem } from "obsidian";

import { citationSettings } from "@zotlit/citations/core/citation-index/settings.ts";
import { ANNOTATION_SUGGESTER_ENABLED } from "@zotlit/plugin-kernel/constants.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingsKey } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { annotationTriggerError } from "#core/annotation-suggest/annotation-trigger.ts";

export function annotationTriggerItems(): SettingGroupItem<SettingsKey>[] {
  if (!ANNOTATION_SUGGESTER_ENABLED) return [];
  return [
    {
      id: "settings_citation_annotation_trigger",
      name: m.settings_citation_annotation_trigger_name(),
      desc: m.settings_citation_annotation_trigger_desc(),
      control: {
        type: "text",
        key: "citation.annotation-trigger",
        placeholder: citationSettings.defaults["citation.annotation-trigger"],
        validate: annotationTriggerError,
      },
    },
  ];
}
