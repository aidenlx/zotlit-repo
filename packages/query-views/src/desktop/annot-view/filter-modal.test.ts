import type { QueryViewDeps } from "#desktop/query-view/view.tsx";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Scope } from "obsidian";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { expect, vi } from "vitest";

import { makeAnnotHost } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";

import { SidebarFilterModal } from "./filter-modal.tsx";

import { noLiteratureNotes } from "#__fixtures__/query-view/literature-notes.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { QueryService } from "#desktop/item-query/service.ts";
import { QueryView } from "#desktop/query-view/view.tsx";

it.effect(
  "closing the filter modal interrupts its read and releases the snapshot",
  () =>
    Effect.gen(function* () {
      const started = Promise.withResolvers<void>();
      let interrupted = false;
      let released = false;
      const host = yield* Effect.acquireDisposable(
        Effect.sync(() =>
          makeAnnotHost(layerUnreadViewServices, {
            reads: {
              snapshot: Effect.acquireRelease(
                Effect.succeed(
                  readsAnswering({
                    CollectionPaths: () =>
                      Effect.gen(function* () {
                        started.resolve();
                        return yield* Effect.never;
                      }).pipe(
                        Effect.ensuring(
                          Effect.sync(() => {
                            interrupted = true;
                          }),
                        ),
                      ),
                  }),
                ),
                () =>
                  Effect.sync(() => {
                    released = true;
                  }),
              ),
            },
            services: Layer.mergeAll(
              Layer.mock(LibraryScope, { current: Effect.succeed(null) }),
              Layer.mock(QueryService, {
                customFieldNames: Effect.succeed([]),
              }),
            ),
          }),
        ),
      );
      const app = stubService<App>("App", {});
      const query = new QueryView(
        stubService<QueryViewDeps>("QueryViewDeps", {
          app,
          registry: host.registry,
          literatureNotes: noLiteratureNotes(),
          opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
        }),
        {
          scope: new Scope(),
          sourcePath: () => "",
          context: () => undefined,
          save: () => {},
        },
      );
      const modal = new SidebarFilterModal(app, query);
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await act(() => modal.onClose());
        }),
      );
      yield* Effect.promise(() => act(() => modal.onOpen()));
      yield* Effect.promise(() => started.promise);
      yield* Effect.promise(() => act(() => modal.onClose()));
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(interrupted).toBe(true);
          expect(released).toBe(true);
        }),
      );
    }),
);
