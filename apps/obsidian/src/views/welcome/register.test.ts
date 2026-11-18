// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Stream } from "effect";
import type { App } from "obsidian";
import { expect } from "vitest";

import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";

import { readsFixture } from "@/services/zotero-reads/__fixtures__.ts";
import { DbUnavailable } from "@/services/zotero-reads/rpc.ts";
import { ZoteroReads } from "@/services/zotero-reads/service.ts";
import { layerSource } from "@/services/zotero-reads/source.ts";
import { inProcessClient } from "@/services/zotero-reads/test-utils.ts";

import { makeWelcomeHost, waitFor } from "./__fixtures__.ts";
import type { NotFoundSignal } from "./not-found-notice.ts";
import { watchNotFound } from "./register.ts";

// The missing-file condition must survive layer acquisition.
it.effect(
  "signals the missing database to a welcome view that subscribes late",
  () =>
    Effect.gen(function* () {
      const missing = () =>
        Effect.fail(
          new DbUnavailable({
            message: "ENOENT: database is absent",
          }),
        );
      const { service } = yield* readsFixture(
        inProcessClient(
          layerSource({
            initial: {
              databasePath: "/missing/zotero.sqlite",
              readMode: "copy",
              autoRefresh: false,
              locale: null,
              chineseSegmenter: null,
              logLevel: null,
            },
            ports: {
              snapshotSource: missing,
              prepareRead: missing,
              reapReadClones: () => Effect.void,
            },
          }).pipe(Layer.provide(FileSystem.layerNoop({}))),
        ),
      );
      yield* Stream.runHead(
        Stream.filter(service.changes, (state) => state.state === "degraded"),
      );
      const host = createObsidianHost({});
      Object.assign(host.workspace, {
        on: () => ({}),
        offref: () => {},
      });
      const callbacks: (() => void)[] = [];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const callback of callbacks.toReversed()) callback();
        }),
      );
      const views = yield* Effect.acquireRelease(
        Effect.promise(() =>
          makeWelcomeHost({ services: Layer.succeed(ZoteroReads, service) }),
        ),
        (views) => Effect.promise(() => views.close()),
      );
      const signals: NotFoundSignal[] = [];
      watchNotFound(
        {
          app: host.app as unknown as App,
          register: (callback) => {
            callbacks.push(callback);
          },
        },
        { registry: views.registry },
        (signal) => signals.push(signal),
      );
      yield* Effect.promise(() =>
        waitFor(() => expect(signals).toEqual(["db-file-missing"])),
      );
      expect((yield* service.current).dbFileMissing).toBe(true);
      expect(yield* Stream.runHead(service.changes)).toMatchObject({
        value: { dbFileMissing: true },
      });
    }),
);
