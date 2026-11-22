import { Effect, Stream } from "effect";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type {
  LocalServer,
  ReaderTarget,
} from "@zotlit/plugin-services/core/local-server/service.ts";

import { ReaderSessionHost } from "./session.ts";
import type { ReaderSessionTarget } from "./session.ts";

export interface ZoteroReaderResolution {
  target: ReaderSessionTarget;
  selected: readonly string[];
}

export interface ZoteroReaderSessionDeps {
  liveUpdate: Pick<
    LocalServer["Service"],
    "readerTarget" | "readerTargetChanges"
  >;
  bridge: Pick<EffectBridge, "runSync" | "subscribe">;
  resolve: (
    target: ReaderTarget,
    signal: AbortSignal,
  ) => Promise<ZoteroReaderResolution | null>;
  navigate: (annotationKey: string) => void;
}

export class ZoteroReaderSession extends ReaderSessionHost {
  readonly #liveUpdate;
  readonly #bridge;
  readonly #resolve;
  readonly #stopTracking: () => void;
  #resolving: AbortController | null = null;

  constructor({
    liveUpdate,
    bridge,
    resolve,
    navigate,
  }: ZoteroReaderSessionDeps) {
    super({
      source: "zotero",
      navigate,
      select: (annotationKeys) =>
        bridge.runSync(
          Effect.logDebug("Zotero owns its reader's selection").pipe(
            Effect.annotateLogs({ annotations: annotationKeys.length }),
            withLogCategory("reader-session"),
          ),
        ),
    });
    this.#liveUpdate = liveUpdate;
    this.#bridge = bridge;
    this.#resolve = resolve;
    this.refresh();
    this.#stopTracking = bridge.subscribe(
      Stream.drop(liveUpdate.readerTargetChanges, 1),
      (pushed) => {
        if (pushed) this.#track(pushed);
      },
    );
  }

  refresh(): void {
    this.#track(this.#bridge.runSync(this.#liveUpdate.readerTarget));
  }

  override [Symbol.dispose](): void {
    this.#resolving?.abort();
    this.#stopTracking();
    super[Symbol.dispose]();
  }

  #track(pushed: ReaderTarget | null): void {
    this.#resolving?.abort();
    const resolving = new AbortController();
    this.#resolving = resolving;
    if (!pushed) {
      this.#apply(null);
      return;
    }
    void this.#resolve(pushed, resolving.signal).then((resolution) => {
      if (!resolving.signal.aborted) this.#apply(resolution);
    });
  }

  #apply(resolution: ZoteroReaderResolution | null): void {
    this.setTarget(resolution?.target ?? null);
    this.reportSelection(resolution?.selected ?? []);
  }
}
