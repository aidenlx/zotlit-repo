import type { WorkbenchRunner } from "#core/language/host-effects.ts";
import { Effect, Fiber } from "effect";
import type { App, IconName } from "obsidian";
import {
  prepareSimpleSearch,
  renderMatches,
  setIcon,
  SuggestModal,
} from "obsidian";

import { awaitModal, openModalIn } from "@zotlit/obsidian-kit/effect-modal.ts";
import { answerOf } from "@zotlit/obsidian-kit/view-runner.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  CurrentAnswer,
  takeEnter,
} from "@zotlit/plugin-services/obsidian/item-lookup/current-answer.ts";
import {
  appendInlineFlair,
  appendTrailingFlair,
  FLAIR_ROW_CLASS,
} from "@zotlit/plugin-services/obsidian/item-lookup/render-hit.ts";

export interface WorkbenchSuggesterOption {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon?: IconName;
}

export interface WorkbenchSuggesterGroup {
  readonly empty?: string;
  readonly label: string;
  readonly options: readonly WorkbenchSuggesterOption[];
}

export interface WorkbenchSuggesterRequest {
  readonly anchor?: HTMLElement;
  readonly window?: Window;
  readonly title: string;
  readonly placeholder?: string;
  readonly groups: readonly WorkbenchSuggesterGroup[];
  readonly selected?: string;
  readonly search?: {
    readonly run: WorkbenchRunner;
    readonly items: (
      query: string,
    ) => Effect.Effect<readonly WorkbenchSuggesterOption[]>;
  };
}

export interface ChooserScope {
  readonly app: App;
  readonly window: Window;
  readonly run: WorkbenchRunner;
}

type GroupedSuggestion = WorkbenchSuggesterOption & { group: string };

class EditorSuggester extends SuggestModal<GroupedSuggestion> {
  #revision = 0;
  #latest: GroupedSuggestion[] | Fiber.Fiber<GroupedSuggestion[]> = [];
  readonly #current = new CurrentAnswer<GroupedSuggestion>(
    this.resultContainerEl,
  );
  readonly #settle: (answer: string | null) => void;
  #picked = false;
  #search = prepareSimpleSearch("");
  readonly #request: WorkbenchSuggesterRequest;
  constructor(
    app: App,
    request: WorkbenchSuggesterRequest,
    settle: (answer: string | null) => void,
  ) {
    super(app);
    this.#settle = settle;
    takeEnter(this);
    this.setTitle(request.title);
    this.#request = request;
    this.setPlaceholder(request.placeholder ?? request.title);
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_select() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    const empty = request.groups.find((group) => group.empty)?.empty;
    if (empty && request.groups.every((group) => group.options.length === 0))
      this.emptyStateText = empty;
  }
  override getSuggestions(
    query: string,
  ): GroupedSuggestion[] | Promise<GroupedSuggestion[]> {
    const revision = ++this.#revision;
    this.#search = prepareSimpleSearch(query);
    const choices = this.#request.groups
      .flatMap((group) =>
        group.options.map((option) => ({ ...option, group: group.label })),
      )
      .filter(
        (option) =>
          this.#search(
            `${option.label} ${option.hint ?? ""} ${option.group}`,
          ) !== null,
      );
    const search = this.#request.search;
    if (!query.trim() || !search)
      return this.#current.track((this.#latest = choices));
    const newer = Effect.suspend(() => {
      const latest = this.#latest;
      return Array.isArray(latest)
        ? Effect.succeed(latest)
        : Fiber.join(latest);
    });
    const shown = new Set(choices.map(({ id }) => id));
    const searching = search.run(
      search
        .items(query)
        .pipe(
          Effect.flatMap((items) =>
            revision !== this.#revision
              ? newer
              : Effect.succeed([
                  ...choices,
                  ...items
                    .filter(({ id }) => !shown.has(id))
                    .map((item) => ({ ...item, group: "" })),
                ]),
          ),
        ),
    );
    this.#latest = searching;
    return this.#current.track(answerOf(searching, choices));
  }
  override renderSuggestion(option: GroupedSuggestion, el: HTMLElement): void {
    el.addClass("mod-complex", "zt-workbench-suggestion", FLAIR_ROW_CLASS);
    if (option.icon)
      setIcon(
        el.createDiv("suggestion-icon").createSpan("suggestion-flair"),
        option.icon,
      );
    const content = el.createDiv({
      cls: "suggestion-content zt:min-w-0 zt:gap-0.5",
    });
    renderMatches(
      content.createDiv({
        cls: "suggestion-title zt:truncate zt:text-sm zt:leading-tight zt:font-medium",
      }),
      option.label,
      this.#search(option.label)?.matches ?? null,
    );
    if (option.hint || option.group) {
      const note = content.createDiv({
        cls: "suggestion-note zt:leading-tight",
      });
      if (option.hint)
        renderMatches(
          note.createSpan("hint"),
          option.hint,
          this.#search(option.hint)?.matches ?? null,
        );
      if (option.group)
        appendInlineFlair(note, option.group, option.hint ? "zt:ms-1.5" : "");
    }
    for (const match of el.querySelectorAll(".suggestion-highlight")) {
      match.classList.add("zt:text-accent-foreground");
    }
    if (option.id === this.#request.selected) {
      el.setAttribute("aria-current", "true");
      setIcon(
        el.createDiv("suggestion-aux").createSpan({
          cls: "suggestion-flair",
          attr: { "aria-label": m.modal_profile_current() },
        }),
        "check",
      );
    }
    if (option.group) appendTrailingFlair(el, option.group);
  }
  override selectActiveSuggestion(event: MouseEvent | KeyboardEvent): void {
    if (this.#current.answersTypedQuery) super.selectActiveSuggestion(event);
    else
      this.#current.chooseFirst((option) =>
        this.selectSuggestion(option, event),
      );
  }
  override selectSuggestion(
    value: GroupedSuggestion,
    event: MouseEvent | KeyboardEvent,
  ): void {
    this.#current.choose(value, event, (option) => {
      this.#picked = true;
      super.selectSuggestion(option, event);
    });
  }
  override onChooseSuggestion(option: WorkbenchSuggesterOption): void {
    this.#settle(option.id);
  }
  override onClose(): void {
    super.onClose();
    if (!this.#picked) this.#settle(null);
    this.#revision++;
    this.#latest = [];
    this.#current.close();
    this.#request.anchor?.focus();
  }
}

export const chooseWorkbenchOption = (
  app: App,
  request: WorkbenchSuggesterRequest,
): Effect.Effect<string | null> =>
  awaitModal<string | null>((settle) => {
    const modal = new EditorSuggester(app, request, settle);
    openModalIn(
      modal,
      request.window ??
        request.anchor?.ownerDocument.defaultView ??
        activeWindow,
    );
    return modal;
  });
