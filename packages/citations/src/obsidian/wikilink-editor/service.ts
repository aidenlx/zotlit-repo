import type { Extension } from "@codemirror/state";
import { Effect, Layer } from "effect";

import { dispatchToMarkdownEditors } from "@zotlit/obsidian-kit/editor-decoration.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import {
  NoteIndex,
  literatureNoteTargetIn,
} from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import {
  wikilinkDecorationsChanged,
  wikilinkEditorExtension,
} from "./extension.ts";

import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";
import { WikilinkDisplaySettings } from "#obsidian/citekey-navigation/wikilink-display-settings.ts";

export const layerWikilinkEditor = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    const workspace = yield* Workspace;
    const metadata = yield* MetadataCache;
    const notes = yield* NoteIndex;
    const settings = yield* PluginSettings;
    const citationText = yield* CitationText;
    const lookup = yield* CitationLookup;
    const citationPopover = yield* CitationPopover;
    const citekeyEditor = yield* CitekeyEditor;
    const bridge = yield* scopedBridge;
    const run = Effect.runSyncWith(yield* Effect.context<never>());

    const display = new WikilinkDisplaySettings();

    const extensions: Extension[] = [
      wikilinkEditorExtension({
        literatureNote: (linkpath, sourcePath, answer) =>
          run(
            literatureNoteTargetIn(metadata, linkpath, {
              sourcePath,
              lookup: answer,
            }),
          ),
        observeLookup: (changed) => run(lookup.observe(changed)),
        enabled: () => display.enabled,
        citationText: (path) => run(citationText.peek(path)),
        open: (citekey, pane) =>
          bridge.runAndForget(citekeyEditor.openCitekey(citekey, pane)),
        showPopover: (request) => run(citationPopover.show(request)),
        hoverPreferences: () => display.hover,
        popoverHover: () => display.popoverHover,
        clickIntercepted: () => display.clickIntercepted,
      }),
    ];

    const redraw = (path?: string) =>
      Effect.gen(function* () {
        const editors = dispatchToMarkdownEditors(
          yield* workspace.markdownViews,
          wikilinkDecorationsChanged.of(undefined),
          { path },
        );
        yield* Effect.logTrace("Redrawing wikilink citations").pipe(
          Effect.annotateLogs({ editors, path }),
        );
      });

    host.registerEditorExtension(extensions);
    yield* workspace.updateOptions;
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        extensions.length = 0;
        return workspace.updateOptions;
      }),
    );

    yield* forkEach(display.redraws(settings.changes), () => redraw());
    yield* forkEach(notes.changes, (change) =>
      change.type === "frontmatter-changed" ? undefined : redraw(),
    );
    yield* forkEach(citationText.events, (event) =>
      event.type === "changed"
        ? redraw(event.path)
        : event.type === "invalidated"
          ? redraw()
          : undefined,
    );
  }).pipe(withLogCategory("wikilink-editor")),
);
