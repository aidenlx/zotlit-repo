import type { AnnotationRecord } from "#obsidian/annotation-repository/service.ts";
import {
  AbstractInputSuggest,
  prepareSimpleSearch,
  renderMatches,
  Scope,
} from "obsidian";
import type { App } from "obsidian";
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

import { tagTypeToName } from "@zotlit/db";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { iconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { holdScopeWhileFocused } from "@zotlit/obsidian-kit/focus-scope.ts";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { TagsInput, useTagsInput, useUniqueId } from "@zotlit/ui";
import { composing } from "@zotlit/ui";

import { sameHeldTags } from "./card-controls.ts";
import type { HeldTags } from "./card-controls.ts";
import { renderHeldTagsPanel } from "./editor-sheet.ts";
import type { EditorSurface, HeldDraftActions } from "./editor-sheet.ts";

import { tagChipVariants } from "#core/annot-view/tag-chip.ts";

export type EndTagSession = (withText?: boolean) => void;

export interface TagEditorProps {
  names: readonly string[];
  auto: ReadonlySet<string>;
  hint: string | null;
  libraryNames: () => Promise<readonly string[]>;
  onChange: (names: string[]) => void;
  onClose: () => void;
  onLeave?: () => void;
  saving?: boolean;
  endSession: RefObject<EndTagSession | null>;
  within?: HTMLElement;
  suggestRef?: RefObject<HTMLElement | null>;
}

export function TagEditor({
  names,
  auto,
  hint,
  libraryNames,
  onChange,
  onClose,
  onLeave,
  saving = false,
  endSession,
  within,
  suggestRef,
}: TagEditorProps) {
  return (
    <>
      <TagsInput.Root
        value={names}
        onValueChange={onChange}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target === event.currentTarget) return;
          if (target.dataset.slot === "tags-input-input") return;
          event.preventDefault();
        }}
        className="zt:flex zt:flex-wrap zt:items-center zt:gap-1 zt:rounded-sm zt:p-0.5 zt:text-xs zt:ring-1 zt:ring-border zt:focus-within:ring-border-focus"
      >
        {names.map((name) => (
          <TagsInput.Item
            key={name}
            value={name}
            data-auto={auto.has(name) ? "" : undefined}
            className={tagChipVariants({
              state: "resting",
              density: "dense",
              truncate: true,
              class:
                "zt:flex zt:cursor-default zt:items-center zt:gap-0.5 zt:pe-0.5",
            })}
          >
            {auto.has(name) && (
              <span
                className="zt:flex zt:shrink-0"
                {...tooltipAttrs(m.annot_view_card_tag_auto())}
              >
                <Icon name="bot" size="xs" aria-hidden />
                <span className="zt:sr-only">
                  {m.annot_view_card_tag_auto()}
                </span>
              </span>
            )}
            <TagsInput.ItemText className="zt:block zt:truncate" />
            <TagsInput.ItemRemove
              className={iconButton({ className: "zt-annot-tag-remove" })}
              disabled={saving}
              {...tooltipAttrs(m.annot_view_card_tag_remove({ name }))}
            >
              <Icon name="x" size="xs" />
            </TagsInput.ItemRemove>
          </TagsInput.Item>
        ))}
        <TagField
          libraryNames={libraryNames}
          onClose={onClose}
          onLeave={onLeave}
          saving={saving}
          endSession={endSession}
          within={within}
          suggestRef={suggestRef}
        />
      </TagsInput.Root>
      {hint !== null && (
        <div
          role="status"
          className="zt:mt-1 zt:text-xs zt:text-pretty zt:text-muted-foreground"
        >
          {hint}
        </div>
      )}
    </>
  );
}

function TagField({
  libraryNames,
  onClose,
  onLeave,
  saving,
  endSession,
  within,
  suggestRef,
}: Pick<
  TagEditorProps,
  | "libraryNames"
  | "onClose"
  | "onLeave"
  | "saving"
  | "endSession"
  | "within"
  | "suggestRef"
>) {
  const app = useObsidianApp();
  const { value, add } = useTagsInput();
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useUniqueId();
  const suggest = useRef<TagSuggest | null>(null);
  const ended = useRef(false);
  const latest = useRef({
    value,
    add,
    onClose,
    onLeave,
    saving,
    libraryNames,
    within,
    suggestRef,
  });
  latest.current = {
    value,
    add,
    onClose,
    onLeave,
    saving,
    libraryNames,
    within,
    suggestRef,
  };

  useLayoutEffect(() => {
    const input = inputRef.current;
    const editor = input?.closest<HTMLElement>("[data-slot=tags-input]");
    if (!input || !editor) return;
    const end = (withText: boolean, close = true): void => {
      if (ended.current) return;
      if (close) ended.current = true;
      suggest.current?.close();
      if (withText) latest.current.add(input.value);
      if (close) latest.current.onClose();
      else latest.current.onLeave?.();
    };
    let library: readonly string[] = [];
    void latest.current.libraryNames().then((names) => {
      library = names;
    });
    suggest.current = new TagSuggest(app, input, {
      names: () => library,
      taken: () => latest.current.value,
      pick: (name) => {
        if (!ended.current) latest.current.add(name);
      },
      shown: (el) => {
        const ref = latest.current.suggestRef;
        if (ref) ref.current = el;
      },
    });
    const scope = new Scope(app.scope);
    scope.register([], "Escape", (event) => {
      if (composing(event)) return;
      end(false);
      return false;
    });
    const keys = holdScopeWhileFocused(editor, scope, { keymap: app.keymap });
    const leave = (event: FocusEvent) => {
      const { within, onLeave, saving } = latest.current;
      if ((within ?? editor).contains(event.relatedTarget as Node | null))
        return;
      if (onLeave && saving) return;
      end(true, !onLeave);
    };
    editor.addEventListener("focusout", leave as EventListener);
    endSession.current = (withText = true) => end(withText);
    input.focus({ preventScroll: true });
    return () => {
      editor.removeEventListener("focusout", leave as EventListener);
      keys[Symbol.dispose]();
      suggest.current?.close();
      suggest.current = null;
      endSession.current = null;
      end(true);
    };
  }, [app, endSession]);

  return (
    <>
      <span id={labelId} hidden>
        {m.annot_view_card_tag_placeholder()}
      </span>
      <TagsInput.Input
        inputRef={inputRef}
        className="zt-annot-tag-input zt:min-w-[8ch] zt:flex-1 zt:px-1 zt:outline-none"
        placeholder={m.annot_view_card_tag_placeholder()}
        aria-labelledby={labelId}
        autoComplete="off"
        readOnly={saving}
        onBlur={(event) => {
          if (ended.current) event.preventDefault();
        }}
      />
    </>
  );
}

export function HeldTagsPanel({
  held,
  surface,
  actions,
}: {
  held: HeldTags;
  surface: EditorSurface;
  actions: HeldDraftActions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(actions);
  latest.current = actions;
  const shown = useRef(held);
  if (!sameHeldTags(shown.current, held)) shown.current = held;
  const stable = shown.current;
  useLayoutEffect(() => {
    if (!ref.current) return;
    renderHeldTagsPanel(ref.current, stable, {
      surface,
      actions: {
        save: () => latest.current.save(),
        allowEditing: () => latest.current.allowEditing(),
        discard: () => latest.current.discard(),
      },
    });
  }, [stable, surface]);
  return <div ref={ref} />;
}

interface TagSuggestSource {
  names(): readonly string[];
  taken(): readonly string[];
  pick(name: string): void;
  shown(el: HTMLElement | null): void;
}

class TagSuggest extends AbstractInputSuggest<string> {
  readonly #source: TagSuggestSource;
  #search = prepareSimpleSearch("");

  constructor(app: App, input: HTMLInputElement, source: TagSuggestSource) {
    super(app, input);
    this.#source = source;
  }

  override open(): void {
    super.open();
    this.#source.shown(this.suggestEl);
  }

  override close(): void {
    super.close();
    this.#source.shown(null);
  }

  override getSuggestions(query: string): string[] {
    const text = query.trim();
    if (text === "") return [];
    this.#search = prepareSimpleSearch(text);
    const taken = this.#source.taken();
    const matches = this.#source
      .names()
      .filter(
        (name) =>
          name !== text && !taken.includes(name) && this.#search(name) !== null,
      );
    return taken.includes(text) ? matches : [text, ...matches];
  }

  override renderSuggestion(name: string, el: HTMLElement): void {
    el.addClass("mod-nowrap");
    renderMatches(el, name, this.#search(name)?.matches ?? null);
  }

  override selectSuggestion(name: string): void {
    this.#source.pick(name);
    this.close();
  }
}

export function autoTags(annot: AnnotationRecord): ReadonlySet<string> {
  return new Set(
    annot.tagDetails
      ?.filter(({ type }) => tagTypeToName(type) === "auto")
      .map(({ name }) => name),
  );
}
