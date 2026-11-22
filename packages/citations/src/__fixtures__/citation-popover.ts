import { Effect, Layer, Stream } from "effect";
import type { ManagedRuntime } from "effect";
import type { TFile } from "obsidian";

import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadLease, ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";
import type {
  CitationLookupAnswer,
  CitationLookupRequest,
} from "@zotlit/zotero-reads/contract/citation-lookup.ts";
import type { ResolvedLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import type { CitationLookupStatus } from "#obsidian/citation-index/lookup-service.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import type { DocumentCitationSet } from "#obsidian/citation-index/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import type { DocumentCitations } from "#obsidian/citation-text/service.ts";
import type { EffectivePresentation } from "#obsidian/pandoc/document-presentation.ts";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";
import type {
  BibliographyRenderOutcome,
  BibliographyRenderResult,
  RenderPresentation,
} from "#obsidian/pandoc/render-cache.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import type { ProfileStyleReader } from "#obsidian/pandoc/profile-styles.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";

import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { layerCitationPopover } from "#desktop/citation-popover/layer.tsx";

export interface CitationPopoverFixtureDeps {
  host: HostSources;
  db: {
    current: ZoteroReads["Service"]["current"];
    reads?: ZoteroReadsApi;
    acquireRead(): Promise<ZoteroReadLease>;
  };
  services?: {
    citationLookup?: CitationLookup["Service"];
    citationIndex?: CitationIndex["Service"];
    citationText?: CitationText["Service"];
    bibliographyRender?: BibliographyRender["Service"];
  };
  citationLookup?: {
    status: CitationLookupStatus;
    read?(
      request: CitationLookupRequest,
      options?: { signal?: AbortSignal },
    ): Promise<CitationLookupAnswer>;
    changed?: Stream.Stream<void>;
    "status-changed"?: Stream.Stream<void>;
  };
  citationIndex?: {
    getDocumentCitationSet(
      file: TFile,
      options: {
        signal?: AbortSignal;
        include?: { citekeys?: readonly string[] };
      },
    ): Promise<unknown>;
  };
  libraryScope: { current: unknown };
  showInLibrary?: (indexedKey: string) => void;
  citationText?: {
    read(
      path: string,
      options: { signal: AbortSignal },
    ): Promise<DocumentCitations | null>;
  };
  profile: ProfileStyleReader;
  bibliographyRender?: {
    changed?: Stream.Stream<unknown>;
    settled?: Stream.Stream<unknown>;
    "style-missing"?: Stream.Stream<string>;
    vaultPresentation?: EffectivePresentation;
    render?(
      items: Parameters<BibliographyRender["Service"]["render"]>[0],
      presentation?: RenderPresentation,
    ): Promise<unknown>;
    readBibliography?(
      items: Parameters<BibliographyRender["Service"]["readBibliography"]>[0],
      options: { signal: AbortSignal },
    ): Promise<unknown>;
    invalidated?: Stream.Stream<void>;
  };
}

export interface CitationPopoverFixture extends AsyncDisposable {
  service: CitationPopover["Service"];
  runtime: ManagedRuntime.ManagedRuntime<CitationPopover, never>;
}

export function citationPopoverFixture(
  deps: CitationPopoverFixtureDeps,
  options: { logs?: Layer.Layer<never> } = {},
): CitationPopoverFixture {
  const stack = new AsyncDisposableStack();
  const citationLookup = deps.citationLookup ?? { status: "fresh" as const };
  const bibliographyRender = deps.bibliographyRender ?? {};
  let revision = 0;
  const lookupState = () => ({
    status: citationLookup.status,
    revision: String(revision),
    stopped: false,
  });
  const layer = layerCitationPopover.pipe(
    Layer.provide(
      Layer.mergeAll(
        options.logs ?? Layer.empty,
        layerHost(deps.host),
        Layer.succeed(
          ShowInLibrary,
          ShowInLibrary.of({
            show: (indexedKey) =>
              Effect.sync(() => deps.showInLibrary?.(indexedKey)),
          }),
        ),
        Layer.succeed(
          ZoteroReads,
          stubService<ZoteroReads["Service"]>("ZoteroReads", {
            current: deps.db.current,
            reads:
              deps.db.reads ??
              Object.assign(stubService<ZoteroReadsApi>("ZoteroReadsApi", {}), {
                ItemsByIndexedKeys: () => Effect.succeed(new Map()),
              }),
            snapshot: Effect.acquireDisposable(
              Effect.tryPromise({
                try: () => deps.db.acquireRead(),
                catch: (error) =>
                  new DbUnavailable({
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
              }),
            ).pipe(Effect.map((lease) => lease.reads)),
          }),
        ),
        Layer.succeed(
          CitationLookup,
          deps.services?.citationLookup ??
            stubService<CitationLookup["Service"]>("CitationLookup", {
              current: Effect.sync(lookupState),
              changes: Stream.concat(
                Stream.succeed(lookupState()),
                (citationLookup.changed ?? Stream.empty).pipe(
                  Stream.map(() => {
                    revision += 1;
                    return lookupState();
                  }),
                ),
              ),
              read: (request) =>
                citationLookup.read
                  ? Effect.promise(() => citationLookup.read!(request))
                  : Effect.promise(() =>
                      Promise.reject(
                        new Error("CitationLookup stub lacks read"),
                      ),
                    ),
            }),
        ),
        Layer.succeed(
          CitationIndex,
          deps.services?.citationIndex ??
            stubService<CitationIndex["Service"]>("CitationIndex", {
              getDocumentCitationSet: (file, options) => {
                if (!deps.citationIndex)
                  throw new Error(
                    "CitationIndex stub lacks getDocumentCitationSet",
                  );
                return Effect.promise(() =>
                  deps.citationIndex!.getDocumentCitationSet(
                    file,
                    options ?? {},
                  ),
                ).pipe(Effect.map((value) => value as DocumentCitationSet));
              },
            }),
        ),
        Layer.succeed(
          LibraryScope,
          stubService<LibraryScope["Service"]>("LibraryScope", {
            current: Effect.sync(
              () => deps.libraryScope.current as ResolvedLibraryScope | null,
            ),
          }),
        ),
        Layer.succeed(
          CitationText,
          deps.services?.citationText ??
            stubService<CitationText["Service"]>("CitationText", {
              read: (path) =>
                Effect.promise((signal) =>
                  deps.citationText
                    ? deps.citationText.read(path, { signal })
                    : Promise.resolve(null),
                ).pipe(Effect.map((value) => value)),
            }),
        ),
        Layer.succeed(
          BibliographyRender,
          deps.services?.bibliographyRender ??
            stubService<BibliographyRender["Service"]>("BibliographyRender", {
              state: Effect.sync(() => ({
                vaultPresentation: bibliographyRender.vaultPresentation ?? {
                  styleId: null,
                  locale: null,
                },
                missingStyle: null,
              })),
              events: (bibliographyRender.invalidated ?? Stream.empty).pipe(
                Stream.map(() => ({ _tag: "invalidated" as const })),
              ),
              render: (items, presentation) =>
                Effect.promise(() =>
                  bibliographyRender.render
                    ? bibliographyRender.render(items, presentation)
                    : Promise.resolve({
                        kind: "unavailable",
                        reason: "engine-absent",
                      } as const),
                ).pipe(
                  Effect.map((value) => value as BibliographyRenderOutcome),
                ),
              readBibliography: (items) =>
                Effect.promise((signal) =>
                  bibliographyRender.readBibliography
                    ? bibliographyRender.readBibliography(items, { signal })
                    : Promise.resolve(null),
                ).pipe(
                  Effect.map(
                    (value) => value as BibliographyRenderResult | null,
                  ),
                ),
            }),
        ),
        Layer.succeed(
          ProfileStyles,
          stubService<ProfileStyles["Service"]>("ProfileStyles", {
            loaded: Effect.sync(() => deps.profile.loaded),
            profileOf: (file) =>
              Effect.sync(() => deps.profile.profileOf(file)),
          }),
        ),
      ),
    ),
  );
  const runtime = buildRuntime(layer, stack);
  const service = runtime.runSync(CitationPopover);
  const owned = stack.move();
  return {
    service,
    runtime,
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}
