import type { CitationLookupState } from "#obsidian/citation-index/lookup-service.ts";
import type { CitationTextEvent } from "#obsidian/citation-text/service.ts";
import type { Extension } from "@codemirror/state";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import type { HoverLinkSource } from "obsidian";
import { describe, expect } from "vitest";

import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { layerCitekeyEditorExtension } from "./register.ts";
import { CitekeyEditor } from "./service.ts";

import { settingsFeed } from "#__fixtures__/settings.ts";
import { AnnotationPopover } from "#obsidian/annotation-popover/service.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CITEKEY_HOVER_SOURCE } from "#obsidian/citekey-navigation/index.ts";

/**
 * The extension registration over settings seeded with `overrides`, and a
 * workspace with editors open on `note.md` and `other.md`. `unload` closes it.
 */
const openExtension = Effect.fnUntraced(function* (
  overrides: Partial<Settings> = {},
) {
  const settings = settingsFeed(overrides);
  const extensions: Extension[][] = [];
  const sources: Record<string, HoverLinkSource> = {};
  const host = testPluginHost({
    registerEditorExtension: (extension) => {
      if (Array.isArray(extension)) extensions.push(extension);
    },
    registerHoverLinkSource: (id, info) => {
      sources[id] = info;
    },
  });
  const workspace = new MemoryWorkspace();
  workspace.openMarkdownEditor("note.md");
  workspace.openMarkdownEditor("other.md");
  const text = testEvent<CitationTextEvent>();
  const lookup = testEvent<CitationLookupState>();
  const scope = yield* Scope.fork(yield* Scope.Scope);
  yield* Layer.buildWithScope(
    layerCitekeyEditorExtension.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          layerWorkspaceFrom(workspace),
          settings.layer,
          Layer.mock(CitekeyEditor, {}),
          Layer.mock(CitationText, { events: text.stream }),
          Layer.mock(CitationLookup, {
            changes: lookup.stream,
            invalidated: lookup.stream.pipe(Stream.map(() => undefined)),
          }),
          Layer.mock(CitationPopover, {}),
          Layer.mock(AnnotationPopover, {}),
        ),
      ),
    ),
    scope,
  );
  return {
    settings,
    /** The switchable extension array: the last registration. */
    registered: () => extensions.at(-1)!,
    sources,
    workspace,
    text,
    lookup,
    unload: Scope.close(scope, Exit.void),
  };
});

describe("CitekeyEditor extension settings lifecycle", () => {
  it.effect(
    "registers the extension while formatting or navigation is enabled",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension({
          "citation.show-formatted": false,
          "citation.open-as-links": false,
        });
        expect(h.registered()).toEqual([]);

        h.settings.update({ "citation.show-formatted": true });
        expect(h.registered()).toHaveLength(1);

        h.settings.update({ "citation.open-as-links": true });
        expect(h.registered()).toHaveLength(1);
        expect(h.workspace.reconfigures).toBe(1);

        h.settings.update({ "citation.show-formatted": false });
        expect(h.registered()).toHaveLength(1);

        h.settings.update({ "citation.open-as-links": false });
        expect(h.registered()).toEqual([]);

        h.settings.update({ "citation.show-formatted": true });
        yield* h.unload;
        expect(h.registered()).toEqual([]);
      }),
  );

  it.effect(
    "stays off while Pandoc citations are off, whatever the editor toggle says",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension({
          "citation.pandoc-citations": false,
          "citation.open-as-links": true,
        });
        expect(h.registered()).toEqual([]);

        h.settings.update({ "citation.pandoc-citations": true });
        expect(h.registered()).toHaveLength(1);

        h.settings.update({ "citation.pandoc-citations": false });
        expect(h.registered()).toEqual([]);
      }),
  );
});

describe("CitekeyEditor hover source", () => {
  it.effect(
    "registers one Mod-gated hover-link source for every citekey surface",
    () =>
      Effect.gen(function* () {
        const { sources } = yield* openExtension();

        expect(Object.keys(sources)).toEqual([CITEKEY_HOVER_SOURCE]);
        // Mod is the platform convention, and this row is the Page preview
        // plugin's own gate on the Page preview Hover action.
        expect(sources[CITEKEY_HOVER_SOURCE]?.defaultMod).toBe(true);
        expect(sources[CITEKEY_HOVER_SOURCE]?.display).toBeTruthy();
      }),
  );
});

describe("CitekeyEditor lookup ownership", () => {
  it.effect("leaves lookup redraws to each open editor view", () =>
    Effect.gen(function* () {
      const h = yield* openExtension();

      h.lookup.emit({ status: "fresh", revision: "2", stopped: false });

      expect(h.lookup.subscribers).toBe(0);
      expect(h.workspace.dispatched).toEqual([]);
    }),
  );
});

describe("CitekeyEditor citation text broadcast", () => {
  it.effect(
    "redraws only the editors showing the document whose text changed",
    () =>
      Effect.gen(function* () {
        const h = yield* openExtension();

        h.text.emit({ type: "changed", path: "note.md" });

        expect(h.workspace.dispatched).toEqual(["note.md"]);
      }),
  );

  it.effect("redraws every editor when all citation text goes stale", () =>
    Effect.gen(function* () {
      const h = yield* openExtension();

      h.text.emit({ type: "invalidated" });

      expect(h.workspace.dispatched).toEqual(["note.md", "other.md"]);
    }),
  );
});
