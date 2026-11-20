import { Stream } from "effect";
import type { Plugin } from "obsidian";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { PdfEngine, ReaderExtension } from "@zotlit/pdf-reader";
import "@zotlit/pdf-reader/styles.css";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";
import type {
  ObsidianHostContext,
  PdfReaderRegistration,
} from "@zotlit/pdf-reader/obsidian";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { bridgeLog } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import type { ZotlitPdfReaderPort } from "./service.ts";
import { zotlitReaderT } from "./strings.ts";

import { ZOTLIT_PDF_VIEW_TYPE } from "#obsidian/pdf-annotation-editor/view-type.ts";

export interface ZotlitReaderDeps {
  readonly engine: PdfEngine;
  readonly editorExtension: ReaderExtension<ObsidianHostContext>;
  readonly bridge: Pick<EffectBridge, "subscribe" | "runSync" | "runAndForget">;
  readonly notifier: Pick<Notifier["Service"], "show">;
  readonly settings: Pick<PluginSettings["Service"], "changes">;
  readonly port: ZotlitPdfReaderPort;
}

export function registerZotlitReader(
  plugin: Plugin,
  deps: ZotlitReaderDeps,
): PdfReaderRegistration {
  const log = bridgeLog(deps.bridge, "pdf-reader");
  const registration = registerPdfReader(plugin, {
    viewType: ZOTLIT_PDF_VIEW_TYPE,
    displayName: m.pdf_reader_view_name(),
    engine: deps.engine,
    extensions: [deps.editorExtension],
    t: zotlitReaderT,
    report: (error, where) => {
      log.error("The PDF reader reported an error", { error, ...where });
    },
  });
  deps.port.registration = registration;
  plugin.register(() => {
    deps.port.registration = null;
  });
  plugin.register(
    deps.bridge.subscribe(
      Stream.changes(
        Stream.map(
          deps.settings.changes,
          (settings) => settings["reader.open-all-pdfs"],
        ),
      ),
      (on) => {
        if (registration.setTakeover(on) === "unavailable")
          deps.bridge.runAndForget(
            deps.notifier.show(m.pdf_reader_takeover_unavailable()),
          );
      },
    ),
  );
  return registration;
}
