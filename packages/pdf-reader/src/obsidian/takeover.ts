import type { Observable } from "#/core/index.ts";
import type {
  EmbedCreator,
  EmbedRegistry,
  ViewRegistry,
} from "#/obsidian/private.ts";
import type { App } from "obsidian";

export type TakeoverState = "off" | "on" | "unavailable";

const EXTENSION = "pdf";

interface Registries {
  readonly views: ViewRegistry;
  readonly embeds: EmbedRegistry;
}

interface Saved {
  readonly viewType: string | undefined;
  readonly creator: EmbedCreator | undefined;
}

function hasMembers(
  value: unknown,
  records: readonly string[],
  methods: readonly string[],
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const members = value as Record<string, unknown>;
  return (
    records.every(
      (name) => typeof members[name] === "object" && members[name] !== null,
    ) && methods.every((name) => typeof members[name] === "function")
  );
}

function registriesOf(app: App): Registries | null {
  const { viewRegistry, embedRegistry } = app as unknown as Record<
    string,
    unknown
  >;
  if (
    !hasMembers(
      viewRegistry,
      ["typeByExtension"],
      ["registerExtensions", "unregisterExtensions"],
    ) ||
    !hasMembers(
      embedRegistry,
      ["embedByExtension"],
      ["registerExtension", "unregisterExtension"],
    )
  ) {
    return null;
  }
  return {
    views: viewRegistry as ViewRegistry,
    embeds: embedRegistry as EmbedRegistry,
  };
}

export interface Takeover extends Disposable {
  readonly state: Observable<TakeoverState>;
  set(on: boolean): TakeoverState;
}

export function makeTakeover(
  app: App,
  options: {
    readonly viewType: string;
    readonly creator: EmbedCreator;
    readonly report: (error: unknown, where: { phase: string }) => void;
  },
): Takeover {
  const listeners = new Set<
    (value: TakeoverState, previous: TakeoverState) => void
  >();
  let state: TakeoverState = "off";
  let saved: Saved | null = null;
  let reported = false;

  const change = (next: TakeoverState): TakeoverState => {
    const previous = state;
    if (next === previous) return next;
    state = next;
    for (const listener of listeners) {
      try {
        listener(next, previous);
      } catch (error) {
        options.report(error, { phase: "subscribe:takeover" });
      }
    }
    return next;
  };

  const restore = (): void => {
    const registries = registriesOf(app);
    const kept = saved;
    saved = null;
    if (!registries || !kept) return;
    const { views, embeds } = registries;
    views.unregisterExtensions([EXTENSION]);
    if (kept.viewType !== undefined) {
      views.registerExtensions([EXTENSION], kept.viewType);
    }
    embeds.unregisterExtension(EXTENSION);
    if (kept.creator !== undefined) {
      embeds.registerExtension(EXTENSION, kept.creator);
    }
  };

  const take = (): TakeoverState => {
    if (saved) return change("on");
    const registries = registriesOf(app);
    if (!registries) {
      if (!reported) {
        reported = true;
        options.report(
          new Error(
            "Obsidian's view or embed registry has no shape this reader knows; PDFs stay with Obsidian's viewer",
          ),
          { phase: "takeover" },
        );
      }
      return change("unavailable");
    }
    const { views, embeds } = registries;
    saved = {
      viewType: views.typeByExtension[EXTENSION],
      creator: embeds.embedByExtension[EXTENSION],
    };
    views.unregisterExtensions([EXTENSION]);
    views.registerExtensions([EXTENSION], options.viewType);
    embeds.unregisterExtension(EXTENSION);
    embeds.registerExtension(EXTENSION, options.creator);
    return change("on");
  };

  return {
    state: {
      get: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    set: (on) => {
      if (on) return take();
      restore();
      return change("off");
    },
    [Symbol.dispose]: () => {
      restore();
      state = "off";
      listeners.clear();
    },
  };
}
