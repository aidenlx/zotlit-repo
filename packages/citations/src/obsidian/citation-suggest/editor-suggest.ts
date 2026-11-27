import { Text } from "@codemirror/state";
import { regex } from "arkregex";
import { Effect } from "effect";
import type {
  Editor,
  EditorPosition,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import { EditorSuggest, Keymap } from "obsidian";

import {
  isCitationCloser,
  placeInsertion,
} from "@zotlit/annotations/obsidian/annot-view/async-insert.ts";
import type { CitationVariant } from "@zotlit/db";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { CurrentAnswer } from "@zotlit/plugin-services/obsidian/item-lookup/current-answer.ts";
import type { SearchSession } from "@zotlit/plugin-services/obsidian/item-lookup/handle.ts";
import { renderSuggestion as renderSearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/render-hit.ts";
import { DEFAULT_LIMIT } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import type { SearchHit } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { scanPandocCitations } from "@zotlit/templates/pandoc-citation";

import { readDocumentCitedKeys } from "./document-citations.ts";
import type { CitationSuggestDeps } from "./register.ts";

const TRIGGER = regex("[\\[【]@([^\\]】]*)$");
const AT_TRIGGER = regex("(?:^|[\\s(\\[{（【「\"'])@([^\\s\\]】]*)$");

export class CitationEditorSuggest extends EditorSuggest<SearchHit> {
  readonly #deps: CitationSuggestDeps;
  #variant: CitationVariant = "main";
  #session: SearchSession | null = null;
  #lookupController?: AbortController;
  #documentController?: AbortController;
  #cited: Promise<readonly string[]> = Promise.resolve([]);
  readonly #answer = new CurrentAnswer<SearchHit>(this.suggestEl);

  constructor(deps: CitationSuggestDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "/ ↵", purpose: m.instruction_insert_alternate_citation() },
      { command: "⇧↵", purpose: m.instruction_insert_alternate_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.suggestions.useSelectedItem(evt);
      return false;
    });
  }

  override onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null,
  ): EditorSuggestTriggerInfo | null {
    if (
      this.#deps.bridge.runSync(this.#deps.settings.current)[
        "citation.editor-suggester"
      ] === false
    ) {
      return null;
    }

    const line = editor.getLine(cursor.line);
    const atTrigger = this.#deps.bridge.runSync(this.#deps.settings.current)[
      "citation.at-trigger"
    ];
    const trigger = resolveCitationTrigger(line, cursor.ch, {
      atTrigger,
    });
    if (!trigger) return null;

    this.#variant = trigger.variant;

    return {
      start: { line: cursor.line, ch: trigger.start },
      end: { line: cursor.line, ch: trigger.end },
      query: trigger.query,
    };
  }

  override getSuggestions(context: EditorSuggestContext): Promise<SearchHit[]> {
    return this.#answer.track(this.#search(context)) as Promise<SearchHit[]>;
  }

  async #search(context: EditorSuggestContext): Promise<SearchHit[] | null> {
    this.#lookupController?.abort();
    const controller = new AbortController();
    this.#lookupController = controller;
    const source = `@${context.query}`;
    const key = scanPandocCitations(source)[0]?.items[0];
    if (key?.start === 0 && source.slice(key.end).trimStart().startsWith(",")) {
      const answer = valueOr(
        await this.#deps.bridge.runPromiseExit(
          this.#deps.citationLookup.read({ citekeys: [key.citationKey] }).pipe(
            recover(
              (cause) =>
                Effect.logDebug(
                  "Locator lookup failed; closing citation suggestions",
                ).pipe(
                  Effect.annotateLogs({
                    cause,
                    citationKey: key.citationKey,
                  }),
                  withLogCategory("views", "citation-suggest"),
                ),
              Effect.succeed(null),
            ),
          ),
          { signal: controller.signal },
        ),
        null,
      );
      if (controller.signal.aborted) return null;
      if (answer === null) return [];
      const found = answer.resolve(key.citationKey);
      if (found.kind === "unique" || found.kind === "ambiguous") {
        this.close();
        return [];
      }
    }
    if (!this.#session) {
      this.#session = this.#deps.lookup.openSession();
      this.#documentController = new AbortController();
      this.#cited = readDocumentCitedKeys(
        this.#deps,
        context.file,
        this.#documentController.signal,
      );
    }
    const session = this.#session;
    const cited = await this.#cited;
    if (session !== this.#session) return [];
    return session.search(context.query, { limit: this.limit, cited });
  }

  override close(): void {
    this.#documentController?.abort();
    this.#lookupController?.abort();
    this.#session?.close();
    this.#session = null;
    this.#answer.close();
    super.close();
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, this.#deps.bridge, hit, el);
  }

  override selectSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    this.#answer.choose(hit, evt, (chosen) => void this.#insert(chosen, evt));
  }

  async #insert(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const context = this.context;
    if (!context) return;

    const variant: CitationVariant =
      this.#variant === "alt" || Keymap.isModifier(evt, "Shift")
        ? "alt"
        : "main";
    const before = context.editor.getValue();
    const outcome = await resolveCitationInsert(this.#deps, hit, variant);
    if (!outcome || context.editor.getValue() !== before) return;
    if (outcome.kind === "notice") {
      new BaseNotice(outcome.message);
      return;
    }
    commitCitationInsert(this.#deps, {
      indexedKey: hit.item.indexedKey,
      text: outcome.text,
      insert: () =>
        writeCitation(context.editor, outcome.text, {
          from: context.start,
          to: context.end,
          replacesTrigger: true,
        }),
    });
  }
}

export function writeCitation(
  editor: Editor,
  citation: string,
  options: {
    from: EditorPosition;
    to: EditorPosition;
    replacesTrigger?: boolean;
  },
): boolean {
  const { from, to } = options;
  const start = editor.posToOffset(from);
  const { insert, cursor } = placeInsertion(citation, {
    kind: "citation",
    replacesTrigger: options.replacesTrigger,
    doc: Text.of(editor.getValue().split("\n")),
    range: { from: start, to: editor.posToOffset(to) },
  });
  editor.replaceRange(insert, from, to);
  editor.setCursor(editor.offsetToPos(start + cursor));
  return true;
}

export function commitCitationInsert(
  deps: Pick<CitationSuggestDeps, "useLedger" | "bridge">,
  {
    indexedKey,
    text,
    insert,
  }: { indexedKey: string; text: string; insert: () => boolean },
): boolean {
  if (text.length === 0 || !insert()) return false;
  deps.bridge.runSync(deps.useLedger.record(indexedKey, "cited"));
  return true;
}

export type CitationInsertOutcome =
  | { kind: "insert"; text: string }
  | { kind: "notice"; message: string };

export async function resolveCitationInsert(
  deps: Pick<
    CitationSuggestDeps,
    "citationTemplate" | "citationLookup" | "bridge"
  >,
  hit: Pick<SearchHit, "item">,
  variant: CitationVariant,
): Promise<CitationInsertOutcome | null> {
  const exit = await deps.bridge.runPromiseExit(
    Effect.gen(function* (): Effect.gen.Return<CitationInsertOutcome> {
      const citationKey =
        "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
      if (!citationKey) {
        return {
          kind: "notice",
          message: m.notice_no_citekey({ key: hit.item.key }),
        };
      }

      if ((yield* deps.citationLookup.current).status === "pending") {
        return { kind: "notice", message: m.notice_citekey_not_ready() };
      }

      const lookup = yield* deps.citationLookup
        .read({ citekeys: [citationKey] })
        .pipe(
          recover(
            (cause) =>
              Effect.logWarning(
                "Citation lookup failed; insertion unavailable",
              ).pipe(
                Effect.annotateLogs({ cause, citationKey }),
                withLogCategory("views", "citation-suggest"),
              ),
            Effect.succeed(null),
          ),
        );
      if (!lookup)
        return { kind: "notice", message: m.notice_citekey_not_ready() };
      if (lookup.resolve(citationKey).kind === "ambiguous") {
        return {
          kind: "notice",
          message: m.notice_citekey_ambiguous_insert({ citekey: citationKey }),
        };
      }

      return yield* Effect.try((): CitationInsertOutcome => {
        const rendered = deps.citationTemplate.renderCitation(
          [{ citationKey, item: hit.item }],
          variant,
        );
        if (rendered === null)
          return { kind: "notice", message: m.notice_template_not_ready() };
        return typeof rendered === "string"
          ? { kind: "insert", text: rendered }
          : { kind: "notice", message: rendered.inert };
      }).pipe(Effect.catch(({ cause }) => Effect.die(cause)));
    }),
  );
  return valueOr(exit, null);
}

export interface CitationTrigger {
  start: number;
  end: number;
  query: string;
  variant: CitationVariant;
}

export function resolveCitationTrigger(
  line: string,
  ch: number,
  {
    atTrigger,
    isKnownCitekey = () => false,
  }: { atTrigger: boolean; isKnownCitekey?: (key: string) => boolean },
): CitationTrigger | null {
  const beforeCursor = line.slice(0, ch);

  const bracketMatch = TRIGGER.exec(beforeCursor);
  if (bracketMatch) {
    const raw = bracketMatch[1] ?? "";
    const source = `@${raw}`;
    const key = scanPandocCitations(source)[0]?.items[0];
    if (
      key?.start === 0 &&
      source.slice(key.end).trimStart().startsWith(",") &&
      isKnownCitekey(key.citationKey)
    ) {
      return null;
    }
    const alternate = raw.endsWith("/");
    return {
      start: bracketMatch.index,
      end: closingBracketAt(line, ch) ? ch + 1 : ch,
      query: alternate ? raw.slice(0, -1) : raw,
      variant: alternate ? "alt" : "main",
    };
  }

  if (!atTrigger) return null;

  const atMatch = AT_TRIGGER.exec(beforeCursor);
  if (!atMatch) return null;

  const raw = atMatch[1] ?? "";
  const alternate = raw.endsWith("/");
  const stripped = alternate ? raw.slice(0, -1) : raw;

  return {
    start: ch - raw.length - 1,
    end: ch,
    query: stripped.replaceAll("_", " "),
    variant: alternate ? "alt" : "main",
  };
}

function closingBracketAt(line: string, ch: number): boolean {
  return isCitationCloser(line.charAt(ch));
}
