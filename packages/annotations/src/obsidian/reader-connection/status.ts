import { Effect, Stream } from "effect";
import type { App } from "obsidian";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { held } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { READER_API } from "@zotlit/reader-api";

import { ReaderConnection } from "./service.ts";
import type { ReaderConnectionState } from "./service.ts";

export const READER_PLUGIN_ID = "zotlit-reader";
const ZOTLIT_PLUGIN_ID = "zotlit";

export type ReaderStatus =
  | "connected"
  | "install"
  | "turn-on"
  | "update-reader"
  | "update-zotlit";

export interface ReaderStatusCopy {
  readonly text: string;
  readonly action: { readonly label: string; readonly url: string } | null;
}

export const readerInstalled = (app: App): boolean =>
  READER_PLUGIN_ID in app.plugins.manifests;

export function readerStatus(
  state: ReaderConnectionState,
  installed: boolean,
): ReaderStatus {
  switch (state.status) {
    case "connected":
      return "connected";
    case "incompatible":
      return state.reason.supported.some((major) => major > READER_API.major)
        ? "update-zotlit"
        : "update-reader";
    case "absent":
      return installed ? "turn-on" : "install";
  }
}

const showPlugin = (id: string) =>
  `obsidian://show-plugin?id=${encodeURIComponent(id)}`;

export function readerStatusCopy(status: ReaderStatus): ReaderStatusCopy {
  switch (status) {
    case "connected":
      return { text: m.settings_reader_status_connected(), action: null };
    case "install":
      return {
        text: m.settings_reader_status_install(),
        action: {
          label: m.settings_reader_status_install_action(),
          url: showPlugin(READER_PLUGIN_ID),
        },
      };
    case "turn-on":
      return {
        text: m.settings_reader_status_turn_on(),
        action: {
          label: m.settings_reader_status_turn_on_action(),
          url: showPlugin(READER_PLUGIN_ID),
        },
      };
    case "update-reader":
      return {
        text: m.settings_reader_status_update({ plugin: "ZotLit Reader" }),
        action: {
          label: m.settings_reader_status_update_action(),
          url: showPlugin(READER_PLUGIN_ID),
        },
      };
    case "update-zotlit":
      return {
        text: m.settings_reader_status_update({ plugin: "ZotLit" }),
        action: {
          label: m.settings_reader_status_update_action(),
          url: showPlugin(ZOTLIT_PLUGIN_ID),
        },
      };
  }
}

export function readerStatusDetail(status: ReaderStatus): string {
  const copy = readerStatusCopy(status);
  return copy.action
    ? `${copy.text} ${m.settings_reader_status_fallback()}`
    : copy.text;
}

export const readerStatusChanges: Effect.Effect<
  Stream.Stream<ReaderStatus>,
  never,
  ReaderConnection | ObsidianApp
> = Effect.gen(function* () {
  const connection = yield* ReaderConnection;
  const app = yield* ObsidianApp;
  return Stream.map(connection.changes, (state) =>
    readerStatus(state, readerInstalled(app)),
  );
});

export const readerStatusAtom = held(
  Stream.unwrap(readerStatusChanges),
  "connected",
);

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ReaderConnection: ReaderConnection;
    ObsidianApp: ObsidianApp;
  }
}
