import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import "@zotlit/pdf-reader/styles.css";
import type { ReaderHost } from "@zotlit/pdf-reader";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";
import { bridgeLog } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { translate } from "@zotlit/plugin-messages/runtime.ts";
import { defineFeature } from "@zotlit/plugin-shell/obsidian/feature.ts";

const READER_VIEW_TYPE = "zotlit-pdf";

const t: ReaderHost["t"] = (key, vars) => translate(key, vars);

export const reader = defineFeature({
  name: "reader",
  onload: ({ plugin, bridge, read }) => {
    const log = bridgeLog(bridge, "pdf-reader");
    const registration = registerPdfReader(plugin, {
      viewType: READER_VIEW_TYPE,
      displayName: m.pdf_reader_view_name(),
      t,
      report: (error, where) => {
        log.error("The PDF reader reported an error", { error, ...where });
      },
    });
    if (registration.setTakeover(true) === "unavailable")
      bridge.runAndForget(
        read(Notifier).show(m.pdf_reader_takeover_unavailable()),
      );
  },
});
