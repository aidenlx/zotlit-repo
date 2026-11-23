import type { CitationLookupObservation } from "#obsidian/citation-index/service.ts";
import type {
  CitationKeyState,
  DocumentCitations,
  PresentedCitation,
} from "#obsidian/citation-text/present.ts";
import type {
  CitationNavigation,
  HoverPreferences,
} from "#obsidian/citekey-navigation/index.ts";
import { Effect, Layer } from "effect";
import { MarkdownRenderChild, setTooltip } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";

import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import {
  Workspace,
  workspaceTrigger,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { renderProfileRecovery } from "@zotlit/obsidian-kit/profile-recovery.ts";
import {
  rerenderReadingViewsIn,
  retireReadingSurface,
} from "@zotlit/obsidian-kit/reading-surface.ts";
import {
  LiveSections,
  isDraftMarkdown,
  markdownViewOf,
  sectionRange,
} from "@zotlit/obsidian-kit/reading-view.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { heldResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { replaceCitations, sectionCitations } from "./render.ts";
import type { SectionCitation } from "./render.ts";

import { citationSettings } from "#core/citation-index/settings.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import {
  citationContent,
  citationElement,
  citationKeyStates,
  citationState,
  citationStateHooks,
  citedWorks,
  citekeyState,
  literalKeyStateOf,
  presentedCitationEqual,
  sectionCoordinates,
} from "#obsidian/citation-text/present.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";
import {
  attachCitationHover,
  attachCitationNavigation,
  attachClosedCitationGestures,
  hoverPreferences,
  markCitationClick,
} from "#obsidian/citekey-navigation/index.ts";
import "./style.css";

interface PlacedCitation {
  element: HTMLElement;
  shown: PresentedCitation | string;
  states: readonly CitationKeyState[];
  navigation: CitationNavigation;
  diagnostic: string | undefined;
}

interface HeldSection {
  citations: readonly SectionCitation[];
  lookup: CitationLookupObservation;
  placed: PlacedCitation[];
}

function shownEqual(
  left: PresentedCitation | string,
  right: PresentedCitation | string,
): boolean {
  if (typeof left === "string" || typeof right === "string") {
    return left === right;
  }
  return presentedCitationEqual(left, right);
}

function setProfileDiagnostic(
  element: HTMLElement,
  diagnostic: string | undefined,
): void {
  if (diagnostic === undefined) {
    element.removeAttribute("aria-label");
    delete element.dataset["citationPresentationError"];
    return;
  }
  element.dataset["citationPresentationError"] = "profile";
  setTooltip(element, diagnostic);
}

export const layerCitekeyReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const vault = yield* Vault;
    const workspace = yield* Workspace;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const citationLookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    let active: boolean | undefined;
    let showFormatted = false;
    let navigationEnabled = false;
    let hover: HoverPreferences = hoverPreferences(citationSettings.defaults);
    const sections = new LiveSections();
    const hoverWorkspace = workspaceTrigger(workspace, run);
    const rerender = rerenderReadingViewsIn(workspace);

    const applySettings = Effect.fnUntraced(function* (
      next: Readonly<Settings>,
    ) {
      hover = hoverPreferences(next);
      const pandocCitations = next["citation.pandoc-citations"];
      const formatted = pandocCitations && next["citation.show-formatted"];
      const navigation = pandocCitations && next["citation.open-as-links"];
      const nextActive = formatted || navigation;
      if (
        nextActive === active &&
        formatted === showFormatted &&
        navigation === navigationEnabled
      ) {
        return;
      }
      const initial = active === undefined;
      const activeChanged = nextActive !== active;
      active = nextActive;
      showFormatted = formatted;
      navigationEnabled = navigation;
      if (activeChanged) {
        yield* Effect.logInfo(
          nextActive ? "Citekey reading enabled" : "Citekey reading disabled",
        );
      } else {
        yield* Effect.logDebug("Citekey reading treatment changed").pipe(
          Effect.annotateLogs({
            navigationEnabled: navigation,
            showFormatted: formatted,
          }),
        );
      }
      if (initial) return;
      yield* rerender;
    });

    const buildCitationElement = (
      doc: Document,
      sourcePath: string,
      {
        content,
        states,
        works,
        at,
        lookup,
      }: {
        content: PresentedCitation | string;
        states: readonly CitationKeyState[];
        works: CitationNavigation["works"];
        at: CitationNavigation["shown"];
        lookup: CitationLookupAnswer | null;
      },
    ): { element: HTMLElement; navigation: CitationNavigation } => {
      const themeClasses = [
        themeHook.citationKey,
        ...citationStateHooks(citationState(states)),
      ];
      const element = citationElement(doc, content, themeClasses);
      const navigation: CitationNavigation = {
        works,
        shown: at,
        where: { surface: "reading" },
        open: (citekey, pane) => {
          bridge.runAndForget(citekeyEditor.openCitekey(citekey, pane));
        },
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => hover,
        hoverNotePath: (citekey) =>
          run(citekeyEditor.hoverNotePath(citekey, lookup)),
        workspace: hoverWorkspace,
        hoverTarget: () => {
          const hoverParent = markdownViewOf(
            run(workspace.markdownViews),
            element,
          );
          return hoverParent === null
            ? null
            : { workspace: hoverWorkspace, hoverParent, sourcePath };
        },
      };
      if (navigationEnabled && states.includes("resolved")) {
        markCitationClick(element, "open");
        attachCitationNavigation(element, navigation);
        return { element, navigation };
      }
      markCitationClick(element, "none");
      if (!navigationEnabled && showFormatted) {
        attachClosedCitationGestures(element, navigation);
        return { element, navigation };
      }
      attachCitationHover(element, navigation);
      return { element, navigation };
    };

    const show = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
      {
        citations,
        lookup,
        placed,
        text,
      }: HeldSection & { text: Held<DocumentCitations> | null },
    ): void => {
      const answer = text?.value.lookup ?? lookup.current?.value ?? null;
      const resolutionPending = answer === null;
      if (text === null && !resolutionPending) return;
      const failure = text?.value.presentationFailure;
      const diagnostic =
        failure &&
        m.notice_imported_note_profile_unknown({
          stamp: failure.diagnostic.stamp,
          target: failure.target,
        });
      renderProfileRecovery(
        el,
        { workspace: hoverWorkspace },
        {
          path: failure?.target,
        },
      );
      const snapshotState = (citekey: string) =>
        citekeyState(heldResolution(answer, citekey));
      const stateOf =
        text === null ? snapshotState : literalKeyStateOf(text.value);
      const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
      const place = (citation: SectionCitation, index: number): HTMLElement => {
        const content = showFormatted
          ? text === null
            ? null
            : citationContent(citation, text.value, coordinates[index])
          : null;
        const previous = placed[index];
        const shown =
          content ??
          (text?.status === "fresh" ? citation.source : previous?.shown) ??
          citation.source;
        const nextDiagnostic =
          text === null ? previous?.diagnostic : diagnostic;
        const states = citationKeyStates(citation, stateOf);
        const works = text === null ? [] : citedWorks(citation, text.value);
        const at =
          content === null ? undefined : { citation, at: coordinates[index] };
        if (
          previous !== undefined &&
          shownEqual(previous.shown, shown) &&
          previous.states.length === states.length &&
          previous.states.every((state, i) => state === states[i])
        ) {
          if (nextDiagnostic !== previous.diagnostic) {
            setProfileDiagnostic(previous.element, nextDiagnostic);
            previous.diagnostic = nextDiagnostic;
          }
          Object.assign(previous.navigation, {
            works,
            shown: at,
            hoverNotePath: (citekey: string) =>
              run(citekeyEditor.hoverNotePath(citekey, answer)),
          });
          return previous.element;
        }
        const built = buildCitationElement(el.ownerDocument, ctx.sourcePath, {
          content: shown,
          states,
          works,
          at,
          lookup: answer,
        });
        if (nextDiagnostic !== undefined)
          setProfileDiagnostic(built.element, nextDiagnostic);
        placed[index] = { ...built, shown, states, diagnostic: nextDiagnostic };
        return built.element;
      };
      if (placed.length === 0) {
        replaceCitations(citations, place);
        return;
      }
      for (const [index, citation] of citations.entries()) {
        const previous = placed[index]!.element;
        const next = place(citation, index);
        if (next !== previous) previous.replaceWith(next);
      }
    };

    const process = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ): void => {
      if (isDraftMarkdown(el)) return;
      if (active !== true) return;
      const citations = sectionCitations(el);
      if (citations.length === 0) return;
      const file = run(vault.getFileByPath(ctx.sourcePath));
      if (!file) return;

      let rewrite: Effect.Effect<void> = Effect.void;
      const lookup = run(citationLookup.observe(() => run(rewrite)));
      const child = new MarkdownRenderChild(el);
      child.onunload = () => lookup[Symbol.dispose]();
      ctx.addChild(child);
      const held: HeldSection = { citations, lookup, placed: [] };
      rewrite = Effect.gen(function* () {
        if (active !== true) return;
        const text = yield* citationText.peek(ctx.sourcePath);
        show(el, ctx, { ...held, text });
      });
      lookup.set({
        citekeys: [
          ...new Set(
            citations.flatMap((citation) =>
              citation.keys.map(({ citekey }) => citekey),
            ),
          ),
        ],
      });
      sections.hold(el, ctx, rewrite);
      run(rewrite);
    };

    host.registerMarkdownPostProcessor((el, ctx) => process(el, ctx));
    yield* forkEach(settings.changes, applySettings);
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? sections.refresh(event.path)
        : event.type === "invalidated"
          ? sections.refresh()
          : undefined,
    );
    yield* retireReadingSurface(workspace, () => {
      active = false;
    });
  }).pipe(withLogCategory("citekey-reading")),
);
