import type { PluginSettings } from "#obsidian/settings/service.ts";
import type { Effect } from "effect";
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { modalAnswer } from "@zotlit/obsidian-kit/modal-answer.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { CurrentAnswer, takeEnter } from "./current-answer.ts";
import type { ItemLookupHandle, SearchSession } from "./handle.ts";
import { renderSuggestion as renderSearchHit } from "./render-hit.ts";
import { DEFAULT_LIMIT } from "./service.ts";
import type { SearchHit, SearchOptions } from "./service.ts";

import { FirstAnswerGate } from "#core/item-lookup/first-answer.ts";

export interface ItemSearchDeps {
  app: App;
  lookup: Pick<ItemLookupHandle, "openSession">;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync">;
}

export abstract class ItemSearchModal extends SuggestModal<SearchHit> {
  readonly #search: ItemSearchDeps;
  #session: SearchSession | null = null;
  readonly #answer = new CurrentAnswer<SearchHit>(this.resultContainerEl);
  readonly #firstAnswer = new FirstAnswerGate({
    hide: () => this.containerEl.addClass("zt:opacity-0"),
    reveal: () => this.containerEl.removeClass("zt:opacity-0"),
    showLoading: () =>
      this.resultContainerEl.createDiv({
        cls: "suggestion-empty",
        text: m.modal_item_search_loading(),
      }),
    win: () => this.containerEl.win,
  });

  constructor(deps: ItemSearchDeps) {
    super(deps.app);
    this.#search = deps;
    this.limit = DEFAULT_LIMIT;
    takeEnter(this);
  }

  override onOpen(): void {
    this.#firstAnswer.open();
    this.#session = this.#search.lookup.openSession();
    void super.onOpen();
  }

  override onClose(): void {
    this.#firstAnswer.close();
    this.#session?.close();
    this.#session = null;
    this.#answer.close();
    super.onClose();
  }

  override getSuggestions(
    query: string,
    options?: Pick<SearchOptions, "cited">,
  ): SearchHit[] | Promise<SearchHit[]> {
    return this.#answer.track(
      Promise.resolve(
        this.#firstAnswer.track(
          this.#session?.search(query, { ...options, limit: this.limit }) ??
            Promise.resolve([]),
        ),
      ),
    );
  }

  protected get answersTypedQuery(): boolean {
    return this.#answer.answersTypedQuery;
  }

  override selectActiveSuggestion(evt: MouseEvent | KeyboardEvent): void {
    if (this.answersTypedQuery) super.selectActiveSuggestion(evt);
    else this.#answer.chooseFirst((hit) => this.selectSuggestion(hit, evt));
  }

  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    if (this.answersTypedQuery) super.selectSuggestion(value, evt);
    else
      this.#answer.choose(value, evt, (hit) => this.selectSuggestion(hit, evt));
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#search.settings, this.#search.bridge, hit, el);
    el.setAttribute("data-indexed-key", hit.item.indexedKey);
  }
}

class ItemPickerModal extends ItemSearchModal {
  #settle: (hit: SearchHit | null) => void = () => undefined;
  #choosing = false;

  constructor(deps: ItemSearchDeps, placeholder: string) {
    super(deps);
    this.setPlaceholder(placeholder);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override selectSuggestion(
    value: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#choosing = this.answersTypedQuery;
    super.selectSuggestion(value, evt);
  }

  override onChooseSuggestion(hit: SearchHit): void {
    this.#settle(hit);
  }

  override onClose(): void {
    super.onClose();
    if (!this.#choosing) this.#settle(null);
  }

  requestInput(): Promise<SearchHit | null> {
    return modalAnswer<SearchHit | null>((settle) => this.ask(settle));
  }

  ask(settle: (hit: SearchHit | null) => void): this {
    this.#settle = settle;
    this.open();
    return this;
  }
}

export function awaitItem(
  deps: ItemSearchDeps,
  placeholder: string,
): Effect.Effect<SearchHit | null> {
  return awaitModal<SearchHit | null>((settle) =>
    new ItemPickerModal(deps, placeholder).ask(settle),
  );
}

export function pickItem(
  deps: ItemSearchDeps,
  placeholder: string,
): Promise<SearchHit | null> {
  return new ItemPickerModal(deps, placeholder).requestInput();
}
