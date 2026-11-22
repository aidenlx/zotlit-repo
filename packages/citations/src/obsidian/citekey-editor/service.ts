import type { AmbiguousCandidate } from "#obsidian/citation-index/ambiguity.ts";
import type {
  HoverPreferences,
  NavigationPane,
} from "#obsidian/citekey-navigation/index.ts";
import { Cause, Context, Effect, Layer, PubSub, Stream } from "effect";

import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  logAndContinue,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { heldResolution } from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type {
  CitationLookupAnswer,
  SnapshotItem,
} from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { CitekeyNoteActions } from "./note-actions.ts";

import { describeCandidatesEffect } from "#obsidian/citation-index/ambiguity.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { hoverPreferences } from "#obsidian/citekey-navigation/index.ts";

export type { AmbiguousCandidate } from "#obsidian/citation-index/ambiguity.ts";

export interface AmbiguousCitekey {
  citekey: string;
  candidates: readonly AmbiguousCandidate[];
  pane: NavigationPane;
}

export type CitekeyEditorEvent =
  | { readonly _tag: "db-unavailable"; readonly citekey: string }
  | { readonly _tag: "citekey-not-found"; readonly citekey: string }
  | {
      readonly _tag: "item-unavailable";
      readonly reason: "database" | "item";
    }
  | {
      readonly _tag: "citekey-ambiguous";
      readonly ambiguous: AmbiguousCitekey;
    };

export interface CitekeyTreatment {
  readonly navigationEnabled: boolean;
  readonly showFormatted: boolean;
  readonly active: boolean;
  readonly annotationCitations: boolean;
  readonly hover: HoverPreferences;
}

export function citekeyTreatment(
  settings: Readonly<Settings>,
): CitekeyTreatment {
  const pandocCitations = settings["citation.pandoc-citations"];
  const navigationEnabled =
    pandocCitations && settings["citation.open-as-links"];
  const showFormatted = pandocCitations && settings["citation.show-formatted"];
  return {
    navigationEnabled,
    showFormatted,
    active: navigationEnabled || showFormatted,
    annotationCitations:
      settings["citation.annotation-citations"] &&
      settings["citation.show-formatted"] &&
      settings["citation.render-annotation-citations"],
    hover: hoverPreferences(settings),
  };
}

export class CitekeyEditor extends Context.Service<
  CitekeyEditor,
  {
    readonly events: Stream.Stream<CitekeyEditorEvent>;
    readonly navigationEnabled: Effect.Effect<boolean>;
    hoverNotePath(
      citekey: string,
      lookup?: CitationLookupAnswer | null,
    ): Effect.Effect<string | null>;
    openCitekey(citekey: string, pane: NavigationPane): Effect.Effect<void>;
    openCandidate(
      candidate: AmbiguousCandidate,
      pane: NavigationPane,
    ): Effect.Effect<void>;
    openIndexedKey(
      indexedKey: string,
      pane: NavigationPane,
    ): Effect.Effect<void>;
  }
>()("zotlit/citekey-editor/CitekeyEditor") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    CitekeyEditor: CitekeyEditor;
  }
}

function uniqueItem(
  citekey: string,
  lookup: CitationLookupAnswer,
): SnapshotItem | null {
  const resolved = heldResolution(lookup, citekey);
  return resolved?.kind === "unique" ? resolved.item : null;
}

function reportFailure<A, E, R, B, R2>(
  effect: Effect.Effect<A, E, R>,
  report: (cause: Cause.Cause<E>) => Effect.Effect<B, never, R2>,
): Effect.Effect<A | B, never, R | R2> {
  return effect.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.interrupt : report(cause),
    ),
  );
}

const log = withLogCategory("citekey-editor");
const contained = logAndContinue("Cannot open the note", "citekey-editor");

export const layerCitekeyEditor: Layer.Layer<
  CitekeyEditor,
  never,
  | CitekeyNoteActions
  | NoteIndex
  | ZoteroReads
  | CitationLookup
  | LibraryScope
  | PluginSettings
  | Workspace
> = Layer.effect(
  CitekeyEditor,
  Effect.gen(function* () {
    const notes = yield* NoteIndex;
    const reads = yield* ZoteroReads;
    const lookup = yield* CitationLookup;
    const libraryScope = yield* LibraryScope;
    const settings = yield* PluginSettings;
    const workspace = yield* Workspace;
    const noteActions = yield* CitekeyNoteActions;
    const events = yield* Effect.acquireRelease(
      PubSub.unbounded<CitekeyEditorEvent>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const report = (event: CitekeyEditorEvent) => PubSub.publish(events, event);

    const readItem = (indexedKey: string) =>
      reads.reads
        .ItemsByIndexedKeys({ indexedKeys: [indexedKey] })
        .pipe(Effect.map((items) => items.get(indexedKey)));

    const openNote = (path: string, pane: NavigationPane) =>
      workspace.openLinkText(path, "", {
        newLeaf: pane,
        state: { active: true },
      });

    const openItem = Effect.fnUntraced(function* (
      item: SnapshotItem,
      pane: NavigationPane,
      citekey?: string,
    ) {
      const existing = noteActions.pickExisting(
        yield* notes.getNotesByItemKey(item.indexedKey),
      );
      if (existing) {
        yield* Effect.logDebug("Opened citekey note").pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            path: existing.path,
            branch: "existing",
          }),
        );
        yield* openNote(existing.path, pane);
        return;
      }

      const zoteroItem = yield* readItem(item.indexedKey);
      if (!zoteroItem) {
        yield* Effect.logDebug("Citekey open blocked").pipe(
          Effect.annotateLogs({
            indexedKey: item.indexedKey,
            branch: "citekey-not-found",
          }),
        );
        yield* report({
          _tag: "citekey-not-found",
          citekey: citekey ?? item.key,
        });
        return;
      }

      const file = yield* noteActions
        .create(zoteroItem)
        .pipe(
          Effect.catch((error) =>
            Effect.logError("Cannot create the citekey note").pipe(
              Effect.annotateLogs({ indexedKey: item.indexedKey, error }),
              Effect.as(null),
            ),
          ),
        );
      if (!file) {
        yield* Effect.logDebug("Citekey note creation cancelled").pipe(
          Effect.annotateLogs({ indexedKey: item.indexedKey }),
        );
        return;
      }
      yield* Effect.logDebug("Created citekey note").pipe(
        Effect.annotateLogs({
          indexedKey: item.indexedKey,
          path: file.path,
        }),
      );
      yield* openNote(file.path, pane);
    });

    return CitekeyEditor.of({
      events: Stream.fromPubSub(events),
      navigationEnabled: settings.current.pipe(
        Effect.map((current) => citekeyTreatment(current).navigationEnabled),
        Effect.withSpan("CitekeyEditor.navigationEnabled"),
      ),
      hoverNotePath: Effect.fnUntraced(function* (citekey, answer) {
        const item = answer ? uniqueItem(citekey, answer) : null;
        if (!item) return null;
        const matches = yield* notes.getNotesByItemKey(item.indexedKey);
        return matches.length === 1 ? matches[0]!.path : null;
      }),
      openCitekey: Effect.fn("CitekeyEditor.openCitekey")(
        function* (citekey, pane) {
          const answer = yield* reportFailure(
            Effect.all(
              [notes.whenIndexed, lookup.read({ citekeys: [citekey] })],
              { concurrency: "unbounded" },
            ).pipe(Effect.map(([, answer]) => answer)),
            (cause) =>
              Effect.logWarning(
                "Cannot resolve citekey for navigation",
                cause,
              ).pipe(
                Effect.annotateLogs({ citekey }),
                Effect.andThen(report({ _tag: "db-unavailable", citekey })),
                Effect.as(null),
              ),
          );
          if (answer === null) return;

          const resolved = answer.resolve(citekey);
          if (resolved.kind === "ambiguous") {
            yield* Effect.logDebug("Citekey names several items").pipe(
              Effect.annotateLogs({
                citekey,
                candidates: resolved.candidates.length,
              }),
            );
            const current = yield* libraryScope.current;
            const candidates = yield* describeCandidatesEffect(
              { db: reads, libraryScope: { current } },
              resolved.candidates,
            );
            yield* report({
              _tag: "citekey-ambiguous",
              ambiguous: { citekey, candidates, pane },
            });
            return;
          }
          if (resolved.kind === "missing") {
            const branch =
              (yield* reads.current).state === "ready"
                ? "citekey-not-found"
                : "db-unavailable";
            yield* Effect.logDebug("Citekey open blocked").pipe(
              Effect.annotateLogs({ citekey, branch }),
            );
            yield* report({ _tag: branch, citekey });
            return;
          }

          yield* openItem(resolved.item, pane, citekey);
        },
        contained,
        log,
      ),
      openCandidate: Effect.fn("CitekeyEditor.openCandidate")(
        function* (candidate, pane) {
          yield* notes.whenIndexed;
          yield* openItem(candidate, pane);
        },
        contained,
        log,
      ),
      openIndexedKey: Effect.fn("CitekeyEditor.openIndexedKey")(
        function* (indexedKey, pane) {
          yield* notes.whenIndexed;
          if ((yield* reads.current).state === "degraded") {
            yield* report({ _tag: "item-unavailable", reason: "database" });
            return;
          }
          const item = yield* reportFailure(readItem(indexedKey), (cause) =>
            Effect.logWarning("Cannot read Item for navigation", cause).pipe(
              Effect.annotateLogs({ indexedKey }),
              Effect.andThen(
                report({ _tag: "item-unavailable", reason: "database" }),
              ),
              Effect.as(null),
            ),
          );
          if (item === null) return;
          if (!item) {
            yield* report({ _tag: "item-unavailable", reason: "item" });
            return;
          }
          yield* openItem(item, pane);
        },
        contained,
        log,
      ),
    });
  }),
);
