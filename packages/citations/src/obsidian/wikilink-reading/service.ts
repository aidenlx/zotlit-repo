import type {
  DocumentCitations,
  ShownCitation,
} from "#obsidian/citation-text/present.ts";
import type { CitationHover } from "#obsidian/citekey-navigation/index.ts";
import { Effect, Layer } from "effect";
import { setTooltip } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";

import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
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
import {
  citationOfRun,
  citationTarget,
  wikilinkCitation,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";
import type {
  LiteratureNoteTarget,
  RunMember,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import {
  NoteIndex,
  literatureNoteTargetIn,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import {
  hasInternalLink,
  renderCitationRuns,
  sectionCitationRuns,
  sectionLinktexts,
} from "./render.ts";
import type { SectionRuns } from "./render.ts";

import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import {
  citationContent,
  sectionCoordinates,
  showCitation,
} from "#obsidian/citation-text/present.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";
import {
  clickWikilinkCitation,
  hoverWikilinkCitation,
  markCitationClick,
} from "#obsidian/citekey-navigation/index.ts";
import { WikilinkDisplaySettings } from "#obsidian/citekey-navigation/wikilink-display-settings.ts";
import "./style.css";

export const layerWikilinkReading = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const vault = yield* Vault;
    const metadata = yield* MetadataCache;
    const workspace = yield* Workspace;
    const notes = yield* NoteIndex;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    const display = new WikilinkDisplaySettings();
    const sections = new LiveSections();
    let retired = false;
    const hoverWorkspace = workspaceTrigger(workspace, run);

    const rerender = rerenderReadingViewsIn(workspace);

    const literatureNoteTargets = Effect.fnUntraced(function* (
      el: HTMLElement,
      {
        sourcePath,
        lookup,
        renderedAnchors,
      }: {
        sourcePath: string;
        lookup: CitationLookupAnswer | null;
        renderedAnchors: ReadonlySet<HTMLAnchorElement>;
      },
    ) {
      const targets = new Map<string, LiteratureNoteTarget | null>();
      if (!display.enabled) return targets;
      for (const linktext of sectionLinktexts(el, renderedAnchors)) {
        const target = citationTarget(linktext);
        if (target === null || targets.has(target.linkpath)) continue;
        targets.set(
          target.linkpath,
          yield* literatureNoteTargetIn(metadata, target.linkpath, {
            sourcePath,
            lookup,
          }),
        );
      }
      return targets;
    });

    const sectionRuns = (
      el: HTMLElement,
      targets: ReadonlyMap<string, LiteratureNoteTarget | null>,
      renderedAnchors: ReadonlySet<HTMLAnchorElement>,
    ): SectionRuns =>
      sectionCitationRuns(
        el,
        (linktext) =>
          wikilinkCitation(linktext, {
            literatureNote: (linkpath) => targets.get(linkpath) ?? null,
            enabled: display.enabled,
          }),
        renderedAnchors,
      );

    const attachPopover = (
      members: readonly RunMember<HTMLAnchorElement>[],
      shown: ShownCitation,
      { sourcePath, signal }: { sourcePath: string; signal: AbortSignal },
    ): void => {
      const element = members[0]!.source;
      const hover: CitationHover = {
        works: members.map(({ citation }) => ({
          citekey: citation.item.citekey,
          indexedKey: citation.indexedKey,
        })),
        shown,
        where: { surface: "reading" },
        open: (citekey, pane) => {
          bridge.runAndForget(citekeyEditor.openCitekey(citekey, pane));
        },
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => display.hover,
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
      if (display.popoverHover) {
        element.addEventListener(
          "mouseover",
          (event) => {
            hoverWikilinkCitation(event, element, hover);
          },
          { signal },
        );
      }
      if (display.clickIntercepted) {
        markCitationClick(element, "none", { cursor: false });
        element.addEventListener(
          "click",
          (event) => {
            clickWikilinkCitation(event, { where: hover.where });
          },
          { signal },
        );
      }
    };

    const show = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
      {
        candidates,
        diagnosedAnchors,
        rendered,
        signal,
        text,
      }: {
        candidates: SectionRuns;
        diagnosedAnchors: Set<HTMLAnchorElement>;
        rendered: SectionRuns;
        signal: AbortSignal;
        text: Held<DocumentCitations>;
      },
    ): number => {
      const runs = [...rendered, ...candidates].sort((a, b) =>
        documentOrder(a[0]!.source, b[0]!.source),
      );
      const citations = runs.map((members) => citationOfRun(members));
      const failure = text.value.presentationFailure;
      renderProfileRecovery(
        el,
        { workspace: hoverWorkspace },
        { path: failure?.target },
      );
      if (failure) {
        const diagnostic = m.notice_imported_note_profile_unknown({
          stamp: failure.diagnostic.stamp,
          target: failure.target,
        });
        for (const { source } of runs.flat()) {
          source.dataset["citationPresentationError"] = "profile";
          setTooltip(source, diagnostic);
          diagnosedAnchors.add(source);
        }
      }
      const coordinates = sectionCoordinates(citations, sectionRange(ctx, el));
      const contents = citations.map((citation, index) =>
        citationContent(citation, text.value, coordinates[index]),
      );
      const collapsed = new Set(rendered);
      const shown = renderCitationRuns(runs, (members, index) => {
        const content = contents[index] ?? null;
        if (!collapsed.has(members)) {
          if (content !== null) rendered.push(members);
          return content;
        }
        if (content !== null)
          showCitation(members[0]!.source, content, "suppress");
        return null;
      });
      if (!display.popoverHover && !display.clickIntercepted) return shown;
      for (const [index, members] of runs.entries()) {
        if (!rendered.includes(members)) continue;
        attachPopover(
          members,
          { citation: citations[index]!, at: coordinates[index] },
          { sourcePath: ctx.sourcePath, signal },
        );
      }
      return shown;
    };

    const process = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext,
    ): void => {
      if (isDraftMarkdown(el)) return;
      if (retired) return;
      if (!hasInternalLink(el)) return;
      const rendered: SectionRuns = [];
      const diagnosedAnchors = new Set<HTMLAnchorElement>();
      let gestures = new AbortController();
      const rewrite = Effect.gen(function* () {
        if (retired) return;
        gestures.abort();
        gestures = new AbortController();
        const signal = gestures.signal;
        const file = yield* vault.getFileByPath(ctx.sourcePath);
        const text = file === null ? null : yield* citationText.peek(file.path);
        if (text === null) return;
        for (const anchor of diagnosedAnchors) {
          anchor.removeAttribute("aria-label");
          delete anchor.dataset["citationPresentationError"];
        }
        diagnosedAnchors.clear();
        const renderedAnchors = new Set(
          rendered.flatMap((members) => members.map(({ source }) => source)),
        );
        const targets = yield* literatureNoteTargets(el, {
          sourcePath: ctx.sourcePath,
          lookup: text.value.lookup,
          renderedAnchors,
        });
        const candidates = sectionRuns(el, targets, renderedAnchors);
        const shown = show(el, ctx, {
          candidates,
          diagnosedAnchors,
          rendered,
          signal,
          text,
        });
        if (shown > 0) {
          yield* Effect.logTrace("Rendered wikilink citations").pipe(
            Effect.annotateLogs({ path: ctx.sourcePath, count: shown }),
          );
        }
      });
      sections.hold(el, ctx, rewrite);
      run(rewrite);
    };

    host.registerMarkdownPostProcessor((el, ctx) => process(el, ctx));
    yield* forkEach(display.redraws(settings.changes), () => rerender);
    yield* forkEach(notes.changes, (change) =>
      change.type === "frontmatter-changed" ? undefined : rerender,
    );
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? sections.refresh(event.path)
        : event.type === "invalidated"
          ? sections.refresh()
          : undefined,
    );
    yield* retireReadingSurface(workspace, () => {
      retired = true;
    });
  }).pipe(withLogCategory("wikilink-reading")),
);

function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}
