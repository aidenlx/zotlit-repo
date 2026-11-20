import type { Events } from "obsidian";

import type { ConnectRequest, ReaderApi, RefuseReason } from "./index.ts";

export const CONNECT_EVENT = "zotlit-reader:connect";
export const READY_EVENT = "zotlit-reader:ready";

export interface ConnectOptions {
  readonly client: string;
  readonly major: number;
  readonly minor: number;
}

export interface ConnectHandlers {
  onAccept(api: ReaderApi): void;
  onRefuse(reason: RefuseReason): void;
  onAbsent(): void;
}

export function connectReader(
  workspace: Events,
  options: ConnectOptions,
  handlers: ConnectHandlers,
): () => void {
  const { client, major, minor } = options;
  const connect = () => {
    let answered = false;
    const request: ConnectRequest = {
      client,
      major,
      minor,
      accept: (api) => {
        answered = true;
        if (api.api.major === major && api.api.minor >= minor)
          handlers.onAccept(api);
        else
          handlers.onRefuse({
            supported: [api.api.major],
            readerVersion: api.readerVersion,
          });
      },
      refuse: (reason) => {
        answered = true;
        handlers.onRefuse(reason);
      },
    };
    workspace.trigger(CONNECT_EVENT, request);
    if (!answered) handlers.onAbsent();
  };
  const ready = workspace.on(READY_EVENT, connect);
  connect();
  return () => workspace.offref(ready);
}

export function answerConnect(
  workspace: Events,
  apiByMajor: ReadonlyMap<number, ReaderApi>,
): () => void {
  const supported = [...apiByMajor.keys()];
  const readerVersion = apiByMajor.values().next().value?.readerVersion ?? "";
  const answer = (...data: unknown[]) => {
    const request = data[0] as ConnectRequest;
    const api = apiByMajor.get(request.major);
    if (api) request.accept(api);
    else request.refuse({ supported, readerVersion });
  };
  const connect = workspace.on(CONNECT_EVENT, answer);
  workspace.trigger(READY_EVENT);
  return () => workspace.offref(connect);
}
