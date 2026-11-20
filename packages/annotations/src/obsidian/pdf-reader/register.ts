import type { ReaderSource } from "#obsidian/reader-connection/service.ts";
import { Context, Layer, Stream } from "effect";
import type { Plugin } from "obsidian";

import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import "@zotlit/pdf-reader/styles.css";
import type { PdfEngine } from "@zotlit/pdf-reader";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";
import type { PdfReaderRegistration } from "@zotlit/pdf-reader/obsidian";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { bridgeLog } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ConnectHandlers, ReaderApi } from "@zotlit/reader-api";

import type { ZotlitPdfReaderPort } from "./service.ts";
import { zotlitReaderT } from "./strings.ts";

import { ZOTLIT_PDF_VIEW_TYPE } from "#obsidian/pdf-annotation-editor/view-type.ts";

export class BundledReader extends Context.Service<
  BundledReader,
  {
    readonly source: ReaderSource;
    accept(api: ReaderApi): void;
  }
>()("zotlit/pdf-reader/BundledReader") {}

export const layerBundledReader: Layer.Layer<BundledReader> = Layer.sync(
  BundledReader,
  () => {
    let handlers: ConnectHandlers | null = null;
    return BundledReader.of({
      source: (next) => {
        handlers = next;
        next.onAbsent();
        return () => {
          handlers = null;
        };
      },
      accept: (api) => handlers?.onAccept(api),
    });
  },
);

export interface ZotlitReaderDeps {
  readonly engine: PdfEngine;
  readonly bundled: Pick<BundledReader["Service"], "accept">;
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
    t: zotlitReaderT,
    report: (error, where) => {
      log.error("The PDF reader reported an error", { error, ...where });
    },
  });
  deps.port.registration = registration;
  deps.bundled.accept(registration.api);
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
