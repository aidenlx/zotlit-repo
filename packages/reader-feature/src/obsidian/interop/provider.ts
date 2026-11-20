import type { Events, Plugin } from "obsidian";

import type { ReaderApi } from "@zotlit/reader-api";
import { answerConnect } from "@zotlit/reader-api";

export interface Refusal {
  readonly client: string;
  readonly major: number;
  readonly minor: number;
  readonly supported: readonly number[];
}

export function provideReaderApi(
  plugin: Plugin,
  api: ReaderApi,
  onRefuse: (refusal: Refusal) => void,
): void {
  const apiByMajor = new Map([[api.api.major, api]]);
  const supported = [...apiByMajor.keys()];
  const workspace: Events = plugin.app.workspace;
  Object.assign(plugin, { api });
  plugin.register(
    answerConnect(workspace, apiByMajor, {
      onRefuse: ({ client, major, minor }) =>
        onRefuse({ client, major, minor, supported }),
    }),
  );
}
