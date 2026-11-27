import type { Exit } from "effect";
import { Scope } from "effect";

import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";

import type { ItemLookup, SearchHit, SearchOptions } from "./service.ts";

export interface SearchSession extends Disposable {
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  close(): void;
}

export interface ItemLookupHandle {
  search(query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  openSession(): SearchSession;
}

const released = (exit: Exit.Exit<SearchHit[]>) => valueOr(exit, []);

export function bindItemLookup(
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">,
  lookup: ItemLookup["Service"],
): ItemLookupHandle {
  return {
    search: (query, opts) =>
      bridge.runPromiseExit(lookup.search(query, opts)).then(released),
    openSession: () => {
      const { scope, close } = openScope();
      const session = bridge.runSync(Scope.provide(lookup.openSession, scope));
      const end = () => void close();
      return {
        search: (query, opts) =>
          bridge.runPromiseExit(session.search(query, opts)).then(released),
        close: end,
        [Symbol.dispose]: end,
      };
    },
  };
}
