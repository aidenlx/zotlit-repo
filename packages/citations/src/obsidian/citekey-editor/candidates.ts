import type {
  AmbiguousCandidate,
  CandidateRow,
} from "#obsidian/citation-index/ambiguity.ts";
import { Effect, Layer } from "effect";
import type { App } from "obsidian";
import { SuggestModal } from "obsidian";

import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  FLAIR_ROW_CLASS,
  appendInlineFlair,
  appendTrailingFlair,
} from "@zotlit/plugin-services/obsidian/item-lookup/render-hit.ts";

import type { AmbiguousCitekey } from "./service.ts";
import { CitekeyEditor } from "./service.ts";

import { candidateRow } from "#obsidian/citation-index/ambiguity.ts";

export function candidateMatches(row: CandidateRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  return [row.summary, row.library ?? "", row.key].some((field) =>
    field.toLowerCase().includes(trimmed),
  );
}

class AmbiguousCitekeyModal extends SuggestModal<AmbiguousCandidate> {
  readonly #ambiguous: AmbiguousCitekey;
  readonly #choose: (candidate: AmbiguousCandidate) => void;

  constructor(
    app: App,
    ambiguous: AmbiguousCitekey,
    choose: (candidate: AmbiguousCandidate) => void,
  ) {
    super(app);
    this.#ambiguous = ambiguous;
    this.#choose = choose;
    this.setPlaceholder(
      m.citekey_ambiguous_placeholder({ citekey: ambiguous.citekey }),
    );
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): AmbiguousCandidate[] {
    return this.#ambiguous.candidates.filter((candidate) =>
      candidateMatches(candidateRow(candidate), query),
    );
  }

  override renderSuggestion(
    candidate: AmbiguousCandidate,
    el: HTMLElement,
  ): void {
    const row = candidateRow(candidate);
    el.classList.add("zt-citations", "mod-complex", FLAIR_ROW_CLASS);
    const contentEl = el.createDiv({ cls: "suggestion-content zt:min-w-0" });
    contentEl.createDiv({ cls: "suggestion-title", text: row.summary });
    contentEl.createDiv({ cls: "suggestion-note zt:font-mono", text: row.key });
    if (row.library) {
      appendInlineFlair(
        contentEl.createDiv({ cls: "suggestion-note" }),
        row.library,
      );
      appendTrailingFlair(el, row.library);
    }
  }

  override onChooseSuggestion(candidate: AmbiguousCandidate): void {
    this.#choose(candidate);
  }
}

export const layerCitekeyCandidatePicker = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const editor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    yield* forkEach(
      filterTag(editor.events, "citekey-ambiguous"),
      ({ ambiguous }) => {
        new AmbiguousCitekeyModal(host.app, ambiguous, (candidate) => {
          bridge.runAndForget(editor.openCandidate(candidate, ambiguous.pane));
        }).open();
      },
    );
  }),
);
