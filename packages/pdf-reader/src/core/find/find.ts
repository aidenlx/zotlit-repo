import type { FindState } from "#/core/types.ts";
import type { ReaderViewer } from "#/core/viewer/viewer.ts";

import { FindState as PdfFindState } from "@zotlit/pdfjs/viewer";

export const FIND_LIMIT = 1000;

interface MatchesCount {
  readonly current: number;
  readonly total: number;
}

type FindType =
  | ""
  | "again"
  | "casesensitivitychange"
  | "entirewordchange"
  | "diacriticmatchingchange"
  | "highlightallchange";

const OPTION_TYPES = [
  ["caseSensitive", "casesensitivitychange"],
  ["entireWord", "entirewordchange"],
  ["matchDiacritics", "diacriticmatchingchange"],
  ["highlightAll", "highlightallchange"],
] as const;

function resultOf(count: MatchesCount): FindState["result"] {
  if (count.total <= 0) return null;
  return {
    current: count.current,
    total: Math.min(count.total, FIND_LIMIT),
    capped: count.total > FIND_LIMIT,
  };
}

function sameResult(a: FindState["result"], b: FindState["result"]): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.current === b.current &&
      a.total === b.total &&
      a.capped === b.capped)
  );
}

function found(
  find: FindState,
  phase: FindState["phase"],
  result: FindState["result"],
): FindState {
  if (find.phase === phase && sameResult(find.result, result)) return find;
  return { ...find, phase, result };
}

function phaseOf(state: number): FindState["phase"] {
  switch (state) {
    case PdfFindState.PENDING:
      return "pending";
    case PdfFindState.NOT_FOUND:
      return "not-found";
    default:
      return "found";
  }
}

export class FindSession {
  readonly #viewer: ReaderViewer;
  readonly #read: () => FindState;
  readonly #update: (change: (find: FindState) => FindState) => void;
  readonly #searched: () => void;
  #highlightAll: boolean | null = null;

  constructor(
    viewer: ReaderViewer,
    options: {
      readonly read: () => FindState;
      readonly update: (change: (find: FindState) => FindState) => void;
      readonly searched: () => void;
    },
  ) {
    this.#viewer = viewer;
    this.#read = options.read;
    this.#update = options.update;
    this.#searched = options.searched;
    viewer.on<{ readonly state: number; readonly matchesCount: MatchesCount }>(
      "updatefindcontrolstate",
      ({ state, matchesCount }) => {
        this.#update((find) =>
          find.query === ""
            ? find
            : found(find, phaseOf(state), resultOf(matchesCount)),
        );
      },
    );
    viewer.on<{ readonly matchesCount: MatchesCount }>(
      "updatefindmatchescount",
      ({ matchesCount }) => {
        this.#update((find) =>
          find.query === ""
            ? find
            : found(find, find.phase, resultOf(matchesCount)),
        );
      },
    );
  }

  changed(previous: FindState, next: FindState): void {
    this.#highlightAll = null;
    if (previous.open && !next.open) {
      this.#viewer.eventBus.dispatch("findbarclose", { source: this });
      return;
    }
    if (!next.open) return;
    if (next.query !== previous.query || (!previous.open && next.query)) {
      this.#search("", false);
      return;
    }
    for (const [key, type] of OPTION_TYPES) {
      if (previous[key] !== next[key]) {
        this.#search(type, false);
        return;
      }
    }
  }

  fromHash(query: string): void {
    this.#highlightAll = true;
    this.#update((find) => ({ ...find, open: true, query }));
    this.#search("", false);
  }

  again(findPrevious: boolean): boolean {
    const find = this.#read();
    if (!find.open || find.query === "") return false;
    this.#search("again", findPrevious);
    return true;
  }

  reset(): void {
    this.#update((find) => found(find, "idle", null));
  }

  resume(): void {
    const find = this.#read();
    if (find.open && find.query !== "") this.#dispatch("", false);
  }

  #search(type: FindType, findPrevious: boolean): void {
    this.#searched();
    this.#dispatch(type, findPrevious);
  }

  #dispatch(type: FindType, findPrevious: boolean): void {
    const find = this.#read();
    if (find.query === "") {
      this.#update((current) => found(current, "idle", null));
    }
    this.#viewer.eventBus.dispatch("find", {
      source: this,
      type,
      query: find.query,
      caseSensitive: find.caseSensitive,
      entireWord: find.entireWord,
      highlightAll: this.#highlightAll ?? find.highlightAll,
      matchDiacritics: find.matchDiacritics,
      findPrevious,
    });
  }
}
