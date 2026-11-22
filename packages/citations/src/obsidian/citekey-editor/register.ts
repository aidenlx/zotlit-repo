import type { Extension } from "@codemirror/state";
import { Effect, Layer, Stream } from "effect";

import { dispatchToMarkdownEditors } from "@zotlit/obsidian-kit/editor-decoration.ts";
import {
  Workspace,
  workspaceTrigger,
} from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { annotationLinkHoverExtension } from "./annotation-link.ts";
import {
  citekeyDecorationsChanged,
  citekeyEditorExtension,
} from "./extension.ts";
import { CitekeyEditor, citekeyTreatment } from "./service.ts";
import type { CitekeyTreatment } from "./service.ts";

import { citationSettings } from "#core/citation-index/settings.ts";
import { AnnotationPopover } from "#obsidian/annotation-popover/service.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import {
  CITEKEY_HOVER_SOURCE,
  hoverPreferences,
} from "#obsidian/citekey-navigation/index.ts";

export const layerCitekeyEditorExtension = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const editor = yield* CitekeyEditor;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const lookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const annotationPopover = yield* AnnotationPopover;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    let treatment: CitekeyTreatment = {
      navigationEnabled: false,
      showFormatted: false,
      active: false,
      annotationCitations: false,
      hover: hoverPreferences(citationSettings.defaults),
    };
    const extensions: Extension[] = [];
    const extension = citekeyEditorExtension({
      workspace: workspaceTrigger(workspace, run),
      open: (citekey, pane) =>
        bridge.runAndForget(editor.openCitekey(citekey, pane)),
      showPopover: (request) => run(citationPopover.show(request)),
      hoverPreferences: () => treatment.hover,
      hoverNotePath: (citekey, answer) =>
        run(editor.hoverNotePath(citekey, answer)),
      observeLookup: (changed) => run(lookup.observe(changed)),
      navigationEnabled: () => treatment.navigationEnabled,
      showFormatted: () => treatment.showFormatted,
      citationText: (path) => run(citationText.peek(path)),
    });
    const annotationLinkHover = annotationLinkHoverExtension({
      showAnnotation: (request) =>
        bridge.runAndForget(annotationPopover.show(request)),
      showCitations: () => treatment.annotationCitations,
      citationText: (path) => run(citationText.peek(path)),
      openItem: (indexedKey, pane) =>
        bridge.runAndForget(editor.openIndexedKey(indexedKey, pane)),
    });

    const decorateAgain = (path?: string) =>
      Effect.gen(function* () {
        if (!treatment.active && !treatment.annotationCitations) return;
        const editors = dispatchToMarkdownEditors(
          yield* workspace.markdownViews,
          citekeyDecorationsChanged.of(undefined),
          { path },
        );
        yield* Effect.logTrace("Redrawing citation widgets").pipe(
          Effect.annotateLogs({ editors, path }),
        );
      });

    const apply = (next: CitekeyTreatment) =>
      Effect.gen(function* () {
        const previous = treatment;
        treatment = next;
        const activeChanged = next.active !== previous.active;
        const treatmentChanged =
          next.navigationEnabled !== previous.navigationEnabled ||
          next.showFormatted !== previous.showFormatted;
        if (activeChanged) {
          extensions.length = 0;
          if (next.active) extensions.push(extension);
          yield* workspace.updateOptions;
          yield* Effect.logInfo(
            next.active ? "Citekey editor enabled" : "Citekey editor disabled",
          );
        }
        if (next.annotationCitations !== previous.annotationCitations) {
          yield* decorateAgain();
          yield* Effect.logDebug("Annotation citation treatment changed").pipe(
            Effect.annotateLogs({
              annotationCitations: next.annotationCitations,
            }),
          );
        } else if (!activeChanged && treatmentChanged) {
          yield* decorateAgain();
          yield* Effect.logDebug("Citekey editor treatment changed").pipe(
            Effect.annotateLogs({
              navigationEnabled: next.navigationEnabled,
              showFormatted: next.showFormatted,
            }),
          );
        }
      });

    host.registerHoverLinkSource(CITEKEY_HOVER_SOURCE, {
      display: m.hover_source_citekey(),
      defaultMod: true,
    });
    host.registerEditorExtension(annotationLinkHover);
    host.registerEditorExtension(extensions);
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        extensions.length = 0;
        return workspace.updateOptions;
      }),
    );
    yield* forkEach(
      Stream.map(settings.changes, (next) => citekeyTreatment(next)),
      apply,
    );
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? decorateAgain(event.path)
        : event.type === "invalidated"
          ? decorateAgain()
          : undefined,
    );
  }).pipe(withLogCategory("citekey-editor")),
);
