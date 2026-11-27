import type {
  WorkbenchHost,
  WorkbenchSuggesterOption,
  WorkbenchInputSuggestionsRequest,
  WorkbenchRunner,
} from "#obsidian/workbench-ui/index.tsx";
import { Compartment } from "@codemirror/state";
import { tooltips, ViewPlugin } from "@codemirror/view";
import { Effect } from "effect";
import type { App, HoverParent } from "obsidian";
import {
  AbstractInputSuggest,
  Component,
  MarkdownRenderer,
  prepareSimpleSearch,
  renderMatches,
} from "obsidian";
import { useEffect, useRef } from "react";

import { communityUrl, docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";

import type { ExtractPartial } from "./extract-partial.ts";
import { extractPartialMenu } from "./extract-partial.ts";
import { obsidianPopupKeys } from "./field-popup.ts";
import { templateHover } from "./hover.tsx";

import { nativeCompletion } from "#core/editor/native-completion.ts";
import {
  completionSuggestion,
  templateCompletion,
} from "#core/language/index.ts";
import {
  WorkbenchClipboardError,
  WorkbenchHostError,
} from "#obsidian/workbench-ui/index.tsx";

class MatchInputSuggest extends AbstractInputSuggest<WorkbenchSuggesterOption> {
  readonly #request: WorkbenchInputSuggestionsRequest;
  #search = prepareSimpleSearch("");

  constructor(app: App, request: WorkbenchInputSuggestionsRequest) {
    super(app, request.input);
    this.#request = request;
  }

  override getSuggestions(query: string) {
    this.#search = prepareSimpleSearch(query);
    return this.#request.getSuggestions(query);
  }

  override renderSuggestion(option: WorkbenchSuggesterOption, el: HTMLElement) {
    el.addClass("zt-template-workbench-suggestion");
    if (!option.hint) {
      el.addClass("mod-nowrap");
      renderMatches(
        el,
        option.label,
        this.#search(option.label)?.matches ?? null,
      );
      return;
    }
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    renderMatches(
      content.createDiv("suggestion-title"),
      option.label,
      this.#search(option.label)?.matches ?? null,
    );
    renderMatches(
      content.createDiv("suggestion-note"),
      option.hint,
      this.#search(option.hint)?.matches ?? null,
    );
  }

  override selectSuggestion(option: WorkbenchSuggesterOption) {
    this.#request.onSelect(option.id);
    this.close();
  }
}

export const hostEffect = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, WorkbenchHostError> =>
  Effect.mapError(effect, (cause) => new WorkbenchHostError({ cause }));

export const refuseRender =
  (reason: string): WorkbenchHost["render"] =>
  () =>
    Effect.fail(new WorkbenchHostError({ cause: new Error(reason) }));

export const copyToClipboard = (
  text: string,
): Effect.Effect<void, WorkbenchClipboardError> =>
  Effect.tryPromise({
    try: () => navigator.clipboard.writeText(text),
    catch: (cause) => new WorkbenchClipboardError({ cause }),
  });

const templateCompletionPresentation = nativeCompletion((completion) => {
  const suggestion = completionSuggestion(completion);
  return (
    suggestion && {
      type: suggestion.type,
      ...(suggestion.syntax ? {} : { note: suggestion.detail }),
    }
  );
});

export function createTemplateWorkbenchHost(
  app: App,
  ports: Pick<WorkbenchHost, "render" | "matchData" | "insertTarget"> & {
    readonly run: WorkbenchRunner;
  } & Partial<
      Pick<
        WorkbenchHost,
        "markdown" | "partials" | "openCitationEngineSettings" | "fieldsAction"
      >
    > & {
      hoverParent?: HoverParent;
      extractPartial?: ExtractPartial;
    },
): WorkbenchHost & Disposable & { readonly run: WorkbenchRunner } {
  const open = new Set<() => void>();
  const {
    hoverParent = { hoverPopover: null },
    extractPartial,
    ...rest
  } = ports;
  function track(close: () => void): () => void {
    const release = () => {
      if (open.delete(release)) close();
    };
    open.add(release);
    return release;
  }
  return {
    [Symbol.dispose]() {
      for (const close of open) close();
    },
    ...rest,
    inputSuggestions(request) {
      const popup = new MatchInputSuggest(app, request);
      return { close: track(() => popup.close()) };
    },
    editorPopups(read, parent) {
      const placement = new Compartment();
      return [
        placement.of(tooltips({ parent: parent.ownerDocument.body })),
        ViewPlugin.define((view) => ({
          destroy: parent.onWindowMigrated((win) => {
            view.dispatch({
              effects: placement.reconfigure(
                tooltips({ parent: win.document.body }),
              ),
            });
          }),
        })),
        templateCompletion(read, templateCompletionPresentation),
        obsidianPopupKeys(app),
        templateHover(read, hoverParent),
        extractPartial
          ? extractPartialMenu(read, extractPartial, rest.run)
          : [],
      ];
    },
    copy: copyToClipboard,
    communityUrl: communityUrl(),
    docsUrl: docsUrl(""),
    persistence: {
      read(scope, key) {
        const value: unknown = app.loadLocalStorage(
          `zotlit.workbench.${scope}.${key}`,
        );
        return typeof value === "string" ? value : null;
      },
      write(scope, key, value) {
        app.saveLocalStorage(`zotlit.workbench.${scope}.${key}`, value);
      },
    },
    markdown:
      ports.markdown ??
      function EditorMarkdown({ markdown, showMarkdown }) {
        const container = useRef<HTMLDivElement>(null);
        useEffect(() => {
          const element = container.current;
          if (!element || showMarkdown) return;
          const target = element.createDiv();
          const lifecycle = new Component();
          lifecycle.load();
          void MarkdownRenderer.render(app, markdown, target, "", lifecycle);
          return () => {
            lifecycle.unload();
            target.remove();
          };
        }, [markdown, showMarkdown]);
        return showMarkdown ? (
          <pre>{markdown}</pre>
        ) : (
          <div ref={container} className="markdown-rendered" />
        );
      },
  };
}
