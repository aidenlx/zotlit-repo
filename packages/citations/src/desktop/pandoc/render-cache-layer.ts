// The layer of the bibliography render cache: renders through the Pandoc
// Engine with the CSL styles read from the Zotero data folder.
import type {
  CslStyleRequest,
  ResolvedCslStyle,
} from "#core/pandoc/csl-style.ts";
import type {
  BibliographyRenderEvent,
  BibliographyRenderState,
  RenderPresentation,
} from "#obsidian/pandoc/render-cache.ts";
import { hashKey } from "@tanstack/query-core";
import type { QueryFunction } from "@tanstack/query-core";
import {
  Cause,
  Effect,
  FileSystem,
  Fiber,
  Layer,
  Option,
  PubSub,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import type { CslItemData } from "@zotlit/db";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { packNotice } from "@zotlit/plugin-services/obsidian/managed-binary/pack-notice.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { InstalledStyleCache } from "./styles.ts";

import { styleHasEntryMarkers } from "#core/pandoc/csl-style.ts";
import {
  effectivePresentation,
  vaultPresentation,
} from "#obsidian/pandoc/document-presentation.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import {
  BibliographyRender,
  BibliographyRenderError,
} from "#obsidian/pandoc/render-cache.ts";
import {
  engineRefusal,
  engineUsable,
  PandocEngine,
} from "#obsidian/pandoc/service.ts";

const BIBLIOGRAPHY_RENDER = "bibliography-render";

const renderError = (cause: unknown) =>
  new BibliographyRenderError({
    message: Error.isError(cause) ? cause.message : String(cause),
    cause,
  });
const CITATION_RENDER = "citation-render";

/** A Resolved CSL Style a render can actually run with. */
type RenderStyle = Exclude<ResolvedCslStyle, { kind: "failed" }>;

export const layerBibliographyRender = Layer.effect(
  BibliographyRender,
  Effect.gen(function* () {
    const reads = yield* ZoteroReads;
    const engine = yield* PandocEngine;
    const pref = yield* ZoteroPref;
    const settings = yield* PluginSettings;
    const profile = yield* ProfileStyles;
    const queries = yield* QueryClients;
    const scope = yield* Scope.Scope;
    const { runPromise } = yield* scopedBridge;
    const noticeServices = yield* Effect.context<
      DeviceStorage | Notifier | PluginHost
    >();
    /**
     * A render that gets no engine tells the researcher once which plugin
     * gives it; the render itself answers without the notice.
     */
    const noticeRefusal = (status: PackBinaryRefusal) =>
      packNotice(status).pipe(Effect.provide(noticeServices));
    /** The engine for one render; a refused borrow shows the notice. */
    const borrowEngine = Effect.suspend(() => engine.getEngine).pipe(
      Effect.tapError((error) => noticeRefusal(error.status)),
    );
    const styles = new InstalledStyleCache();
    const fileSystem = yield* FileSystem.FileSystem;
    let closed = false;
    const state = yield* SubscriptionRef.make<BibliographyRenderState>({
      vaultPresentation: vaultPresentation(yield* settings.current, profile),
      missingStyle: null,
    });
    const events = yield* Effect.acquireRelease(
      PubSub.unbounded<BibliographyRenderEvent>(),
      (pubsub) => PubSub.shutdown(pubsub),
    );
    const recover = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.logWarning("Could not update bibliography renders", cause),
        ),
      );
    const invalidate = Effect.fn("BibliographyRender.invalidate")(function* () {
      if (closed) return;
      yield* Effect.logDebug("Bibliography renders went stale");
      for (const prefix of [BIBLIOGRAPHY_RENDER, CITATION_RENDER])
        yield* queries.invalidate([prefix]);
      yield* PubSub.publish(events, { _tag: "invalidated" });
    });
    const listen = <A>(
      stream: Stream.Stream<A>,
      handle: (value: A) => Effect.Effect<unknown>,
    ) =>
      Stream.runForEach(stream, (value) => recover(handle(value))).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
    // Each state subscription skips its acquisition snapshot, just as on("changed") did.
    const initialProfile = yield* profile.state;
    yield* listen(
      Stream.dropWhile(profile.changes, (next) => next === initialProfile),
      () => invalidate(),
    );
    yield* listen(reads.events, (event) =>
      event._tag === "changed" ? invalidate() : Effect.void,
    );
    // A render stands until the engine comes or goes: the first read of an
    // installed pack only confirms the engine the renders already asked for.
    const initialUsable = engineUsable(yield* engine.current);
    yield* listen(
      engine.changes.pipe(
        Stream.map((status) => engineUsable(status)),
        Stream.changes,
        Stream.dropWhile((usable) => usable === initialUsable),
      ),
      () => invalidate(),
    );
    let previousPref = yield* pref.current;
    yield* listen(
      pref.changes,
      Effect.fn("BibliographyRender.preferencesChanged")(function* (next) {
        const changed =
          next.prefs !== previousPref.prefs ||
          next.dataDirOverride !== previousPref.dataDirOverride;
        previousPref = next;
        if (changed) yield* invalidate();
      }),
    );
    yield* listen(
      settings.changes,
      Effect.fn("BibliographyRender.applySettings")(function* (saved) {
        const next = vaultPresentation(saved, profile);
        const before = yield* SubscriptionRef.get(state);
        if (
          before.vaultPresentation.styleId === next.styleId &&
          before.vaultPresentation.locale === next.locale
        )
          return;
        yield* SubscriptionRef.set(state, {
          ...before,
          vaultPresentation: next,
        });
        yield* Effect.logInfo("Citation presentation settings changed").pipe(
          Effect.annotateLogs({ styleId: next.styleId, locale: next.locale }),
        );
        yield* invalidate();
      }),
    );
    yield* listen(
      queries.changes,
      Effect.fn("BibliographyRender.settled")(function* (change) {
        if (
          change.key[0] !== BIBLIOGRAPHY_RENDER &&
          change.key[0] !== CITATION_RENDER
        )
          return;
        const key = renderKeyOf(change.key);
        if (change.changed)
          yield* PubSub.publish(events, { _tag: "changed", key });
        yield* PubSub.publish(events, {
          _tag: "settled",
          key,
          held: change.held,
        });
      }),
    );
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        closed = true;
        yield* PubSub.shutdown(state.pubsub);
      }),
    );
    yield* Effect.logInfo("Vault citation presentation selected").pipe(
      Effect.annotateLogs({
        ...(yield* SubscriptionRef.get(state)).vaultPresentation,
      }),
    );

    const prepare = Effect.fn("BibliographyRender.prepare")(
      function* (presentation: RenderPresentation | undefined) {
        const refusal = engineRefusal(yield* engine.current);
        if (refusal) {
          yield* noticeRefusal(refusal);
          return { reason: "engine-absent" } as const;
        }
        const selected = (yield* SubscriptionRef.get(state)).vaultPresentation;
        const request = effectivePresentation(presentation ?? {}, selected);
        const dataDir = (yield* pref.current).dataDir;
        const style = yield* styles
          .resolve(dataDir, request)
          .pipe(Effect.provideService(FileSystem.FileSystem, fileSystem));
        if (style.kind !== "failed") return { request, style };
        yield* Effect.logDebug(
          "Cannot resolve the requested citation style",
        ).pipe(
          Effect.annotateLogs({
            styleId: style.styleId,
            parentId: style.parentId,
            reason: style.reason,
          }),
        );
        yield* SubscriptionRef.updateSome(state, (before) =>
          !closed &&
          style.styleId === before.vaultPresentation.styleId &&
          before.missingStyle === null
            ? Option.some({ ...before, missingStyle: style.styleId })
            : Option.none(),
        );
        return { reason: "style-missing" } as const;
      },
      withLogCategory("pandoc", "render-cache"),
    );
    const runBibliography = Effect.fn("BibliographyRender.runBibliography")(
      function* (items: readonly CslItemData[], style: RenderStyle) {
        if (items.length === 0) return { entries: [], hasEntryMarkers: false };
        const presentation = enginePresentation(style);
        const active = yield* borrowEngine;
        if (!active) return { entries: [], hasEntryMarkers: false };
        const entries = yield* Effect.tryPromise({
          try: () => active.renderBibliography({ items, ...presentation }),
          catch: renderError,
        });
        const hasEntryMarkers =
          styleHasEntryMarkers(presentation.styleXml) ||
          entries.some((entry) => entry.marker !== undefined);
        yield* Effect.logDebug("Bibliography rendered").pipe(
          Effect.annotateLogs({ count: entries.length, hasEntryMarkers }),
        );
        return { entries, hasEntryMarkers };
      },
      Effect.scoped,
      Effect.tapError((error) =>
        Effect.logWarning("Cannot format the bibliography").pipe(
          Effect.annotateLogs({ error }),
        ),
      ),
    );
    const runCitations = Effect.fn("BibliographyRender.runCitations")(
      function* (
        citations: readonly string[],
        items: readonly CslItemData[],
        style: RenderStyle,
      ) {
        if (citations.length === 0) return [];
        const active = yield* borrowEngine;
        if (!active) return [];
        const rendered = yield* Effect.tryPromise({
          try: () =>
            active.renderCitations({
              citations,
              items,
              ...enginePresentation(style),
            }),
          catch: renderError,
        });
        yield* Effect.logDebug("Citations rendered").pipe(
          Effect.annotateLogs({ count: rendered.length }),
        );
        return rendered;
      },
      Effect.scoped,
      Effect.tapError((error) =>
        Effect.logWarning("Cannot format the citations").pipe(
          Effect.annotateLogs({ error }),
        ),
      ),
    );
    // Start the shared refresh before peeking. A stale value answers immediately;
    // the layer owns the refresh even when this caller stops waiting.
    const askThenPeek = Effect.fn("BibliographyRender.askThenPeek")(function* <
      T,
    >(key: readonly string[], render: QueryFunction<T>) {
      if (closed) return null;
      const asking = yield* Effect.forkIn(queries.ask(key, render), scope, {
        startImmediately: true,
      });
      const held = yield* queries.peek<T>(key);
      if (held !== null) return held;
      yield* Fiber.join(asking);
      return yield* queries.peek<T>(key);
    });
    return BibliographyRender.of({
      state: SubscriptionRef.get(state),
      changes: SubscriptionRef.changes(state),
      events: Stream.fromPubSub(events),
      render: Effect.fn("BibliographyRender.render")(
        function* (items, presentation) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined)
            return { kind: "unavailable", reason: prepared.reason };
          const key = renderKey({ ...prepared, items });
          const record = yield* askThenPeek(
            [BIBLIOGRAPHY_RENDER, key],
            ({ signal }) =>
              runPromise(runBibliography(items, prepared.style), { signal }),
          );
          return record === null
            ? { kind: "unavailable", reason: "failed" }
            : { kind: "held", key, record };
        },
      ),
      renderCitations: Effect.fn("BibliographyRender.renderCitations")(
        function* (citations, items, presentation) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined)
            return { kind: "unavailable", reason: prepared.reason };
          const key = renderKey({ ...prepared, items, citations });
          const record = yield* askThenPeek(
            [CITATION_RENDER, key],
            ({ signal }) =>
              runPromise(runCitations(citations, items, prepared.style), {
                signal,
              }),
          );
          return record === null
            ? { kind: "unavailable", reason: "failed" }
            : { kind: "held", key, record };
        },
      ),
      readBibliography: Effect.fn("BibliographyRender.readBibliography")(
        function* (items, { presentation } = {}) {
          const prepared = yield* prepare(presentation);
          if (prepared.reason !== undefined) return null;
          return yield* queries.readFresh(
            [BIBLIOGRAPHY_RENDER, renderKey({ ...prepared, items })],
            ({ signal }) =>
              runPromise(runBibliography(items, prepared.style), { signal }),
          );
        },
      ),
      readCitations: Effect.fn("BibliographyRender.readCitations")(function* (
        citations,
        items,
        { presentation } = {},
      ) {
        const prepared = yield* prepare(presentation);
        if (prepared.reason !== undefined) return null;
        return yield* queries.readFresh(
          [CITATION_RENDER, renderKey({ ...prepared, items, citations })],
          ({ signal }) =>
            runPromise(runCitations(citations, items, prepared.style), {
              signal,
            }),
        );
      }),
    });
  }).pipe(withLogCategory("pandoc", "render-cache")),
);

/**
 * What the engine formats one Resolved CSL Style with: an installed style hands
 * over its content, and the embedded default style takes the Citation Locale as
 * the locale to render in.
 */
function enginePresentation(style: RenderStyle): {
  styleXml?: string;
  locale?: string;
} {
  return style.kind === "installed"
    ? { styleXml: style.xml }
    : { locale: style.locale };
}

/**
 * Full style and item content separate a cancelled render's captured inputs
 * from updated data under the same IDs. Query Core's stable JSON serialization
 * ignores object property order while preserving item and citation order.
 */
function renderKey({
  request,
  style,
  items,
  citations = [],
}: {
  request: CslStyleRequest;
  style: RenderStyle;
  items: readonly CslItemData[];
  citations?: readonly string[];
}): string {
  return hashKey([
    request.styleId ?? "",
    style.kind === "installed" ? (style.parentId ?? "") : "",
    request.locale ?? "",
    style.kind === "installed" ? style.xml : "",
    items,
    citations,
  ]);
}

/** The {@link renderKey} a held render's query key carries. */
function renderKeyOf(key: readonly unknown[]): string {
  return String(key[1]);
}
