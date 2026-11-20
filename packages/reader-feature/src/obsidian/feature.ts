import { Effect, Stream } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import "@zotlit/pdf-reader/styles.css";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";
import {
  bridgeLog,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { defineFeature } from "@zotlit/plugin-shell/obsidian/feature.ts";
import * as m from "@zotlit/reader-messages/messages.ts";

import { readerPage } from "./settings-page.ts";
import { readerSettings } from "./settings.ts";
import { readerT } from "./strings.ts";

import { provideReaderApi } from "#obsidian/interop/provider.ts";

const READER_VIEW_TYPE = "zotlit-pdf";

export const reader = defineFeature({
  name: "reader",
  settings: [readerSettings],
  settingTab: { entries: { reader: () => [readerPage()] } },
  onload: ({ plugin, bridge, read }) => {
    const log = bridgeLog(bridge, "pdf-reader");
    const registration = registerPdfReader(plugin, {
      viewType: READER_VIEW_TYPE,
      displayName: m.reader_view_name(),
      t: readerT,
      report: (error, where) => {
        log.error("The PDF reader reported an error", { error, ...where });
      },
    });
    provideReaderApi(plugin, registration.api, (refusal) => {
      bridge.runAndForget(
        Effect.logWarning(
          "A plugin asked for a version of the ZotLit Reader API that this Reader does not give",
        ).pipe(Effect.annotateLogs({ ...refusal }), withLogCategory("interop")),
      );
    });
    const notifier = read(Notifier);
    plugin.register(
      bridge.subscribe(
        Stream.changes(
          Stream.map(
            read(PluginSettings).changes,
            (settings) => settings["reader.open-all-pdfs"],
          ),
        ),
        (on) => {
          if (registration.setTakeover(on) === "unavailable")
            bridge.runAndForget(notifier.show(m.reader_takeover_unavailable()));
        },
      ),
    );
  },
});
