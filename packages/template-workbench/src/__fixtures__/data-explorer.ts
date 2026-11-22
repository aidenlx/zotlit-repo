import { Effect, Layer, Queue, Stream } from "effect";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { ContractRoot } from "@zotlit/db";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { makeViewRegistry } from "@zotlit/obsidian-kit/view-atoms.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { waitFor } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { TemplateRoot, WorkbenchItemChoice } from "#obsidian/workbench-ui/index.tsx";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsEvent } from "@zotlit/zotero-reads/client/service.ts";

import { layerUnreadViewServices } from "@zotlit/notes/__fixtures__/view-atoms.ts";
import { TemplateDataReads } from "@zotlit/notes/desktop/template/data-reads.ts";
import { TemplateDataError } from "@zotlit/notes/desktop/template/data.ts";
import type {
  TemplateDataLoader,
  TemplateDataLoadResult,
} from "@zotlit/notes/desktop/template/data.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";

import {
  holdExplorerModel,
  makeExplorerModel,
  refresh,
  setTarget,
} from "#desktop/data-explorer/model.ts";
import type { ExplorerModel, ExplorerSession, ExplorerState } from "#desktop/data-explorer/model.ts";

export interface ExplorerReads {
  read?(
    indexedKey: string,
    root: ContractRoot,
  ): Promise<TemplateDataLoadResult>;
  readCitation?: TemplateDataLoader["loadCitation"];
  recent?(): Effect.Effect<SearchHit[]>;
}

export interface ExplorerHost {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly cancelled: readonly string[];
  changeZotero(): void;
  zoteroSubscribers(): number;
  openSession(): ExplorerSessionHandle;
  setJavascriptEnabled(enabled: boolean): void;
  permissionSubscribers(): number;
  close(): Promise<void>;
}

export interface ExplorerSessionHandle extends Disposable {
  readonly model: ExplorerModel;
  state(): ExplorerState;
  apply(transition: (session: ExplorerSession) => ExplorerSession): void;
  setTarget(
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId?: string | null,
  ): void;
  refresh(): void;
  ready(): Promise<void>;
}

const fromPromise = <A>(evaluate: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: (signal) => evaluate(signal),
    catch: (cause) => new TemplateDataError({ cause }),
  });

export async function makeExplorerHost(
  reads: ExplorerReads = {},
  sources: HostSources = {},
): Promise<ExplorerHost> {
  const stack = new AsyncDisposableStack();
  const zotero = new Set<() => void>();
  const cancelled: string[] = [];
  const permissions = new Set<() => void>();
  let javascriptEnabled = false;
  const runtime = buildRuntime(
    Layer.mergeAll(
      layerUnreadViewServices,
      layerHost(sources),
      Layer.mock(ItemLookup, {
        search: () =>
          Effect.suspend(() => reads.recent?.() ?? Effect.succeed([])),
      }),
      Layer.mock(TemplateDataReads, {
        read: (indexedKey, root) =>
          fromPromise((signal) => {
            signal.addEventListener("abort", () => cancelled.push(indexedKey));
            return reads.read
              ? reads.read(indexedKey, root)
              : Promise.reject(new Error(`no read for ${indexedKey}`));
          }),
        readCitation: (selector, variant) =>
          fromPromise(() =>
            reads.readCitation
              ? reads.readCitation(selector, variant)
              : Promise.reject(new Error("no Citation read")),
          ),
      }),
      Layer.mock(Template, {
        javascriptTemplatesEnabled: Effect.sync(() => javascriptEnabled),
        compileEvents: Stream.callback<void>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const send = () => {
                Queue.offerUnsafe(queue, undefined);
              };
              permissions.add(send);
              return send;
            }),
            (send) => Effect.sync(() => permissions.delete(send)),
          ),
        ),
      }),
      Layer.mock(ZoteroReads, {
        reads: stubService<ZoteroReads["Service"]["reads"]>(
          "ZoteroReadsApi",
          {},
        ),
        events: Stream.callback<ZoteroReadsEvent>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const send = () => {
                Queue.offerUnsafe(queue, { _tag: "changed" });
              };
              zotero.add(send);
              return send;
            }),
            (send) => Effect.sync(() => zotero.delete(send)),
          ),
        ),
      }),
    ),
    stack,
  );
  const registry = makeViewRegistry(await runtime.context(), { idleTTL: 0 });
  return {
    registry,
    cancelled,
    setJavascriptEnabled: (enabled) => {
      javascriptEnabled = enabled;
      for (const send of permissions) send();
    },
    permissionSubscribers: () => permissions.size,
    changeZotero: () => {
      for (const send of zotero) send();
    },
    zoteroSubscribers: () => zotero.size,
    openSession: () => {
      const model = makeExplorerModel();
      const release = holdExplorerModel(registry, model);
      const apply = (
        transition: (session: ExplorerSession) => ExplorerSession,
      ) => registry.update(model.session, transition);
      return {
        model,
        state: () => registry.get(model.state),
        apply,
        setTarget: (item, root, annotationId = null) =>
          apply(setTarget(item, root, annotationId)),
        refresh: () => apply(refresh),
        ready: () =>
          waitFor(() => {
            if (registry.get(model.loaded).waiting)
              throw new Error("The Explorer still reads its data");
          }),
        [Symbol.dispose]: release,
      };
    },
    close: async () => {
      registry.dispose();
      await stack.disposeAsync();
    },
  };
}
