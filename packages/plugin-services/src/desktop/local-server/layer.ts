import type {
  ImportNotesRequest,
  ReaderTarget,
  UpdateManyRequest,
} from "#core/local-server/service.ts";
import type { NoteStatusSource } from "#obsidian/local-server/live-update-app.ts";
import type { Settings } from "#obsidian/settings/service.ts";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  Cause,
  Effect,
  Layer,
  Option,
  PubSub,
  Stream,
  SubscriptionRef,
} from "effect";
import { Hono } from "hono/tiny";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { scopedBridge, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { DbUpdated, NotifyEvent } from "@zotlit/protocol";

import { LocalServer } from "#core/local-server/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { LibrarySource } from "#obsidian/library-source/service.ts";
import { createLiveUpdateApp } from "#obsidian/local-server/live-update-app.ts";
import { NoteIndex } from "#obsidian/note-index/service.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const PORT_RANGE = 10;

const MAX_PORT = 65535;

type BindResult = { server: ServerType; port: number } | "in-use" | "failed";

export const layerLocalServer: Layer.Layer<
  LocalServer,
  never,
  PluginSettings | ZoteroPref | NoteIndex | Notifier
> = Layer.effect(
  LocalServer,
  Effect.gen(function* () {
    const settings = yield* PluginSettings;
    const zoteroPref = yield* ZoteroPref;
    const librarySource = yield* Effect.serviceOption(LibrarySource);
    const notifier = yield* Notifier;
    const noteIndex = yield* NoteIndex;

    const { runSync: run, runPromiseExit } = yield* scopedBridge;

    const available = yield* SubscriptionRef.make(false);
    const boundPort = yield* SubscriptionRef.make<number | null>(null);
    const readerTarget = yield* SubscriptionRef.make<ReaderTarget | null>(null);
    const readerClosed = yield* SubscriptionRef.make(false);

    const dbUpdated = yield* PubSub.unbounded<DbUpdated>();
    const updateMany = yield* PubSub.unbounded<UpdateManyRequest>();
    const importNotes = yield* PubSub.unbounded<ImportNotesRequest>();

    let server: ServerType | null = null;
    let enabled = false;
    let liveUpdateEnabled = false;
    let port = -1;
    let hostname = "";
    let stoppedFlag = false;
    const app = new Hono();

    const refreshAvailability = Effect.fn("LocalServer.refreshAvailability")(
      function* () {
        const next =
          enabled &&
          liveUpdateEnabled &&
          (yield* SubscriptionRef.get(boundPort)) !== null;
        if (next === (yield* SubscriptionRef.get(available))) return;
        yield* SubscriptionRef.set(available, next);
        yield* Effect.logDebug("Server availability changed").pipe(
          Effect.annotateLogs({ available: next }),
        );
      },
    );

    const setReaderClosed = Effect.fn("LocalServer.setReaderClosed")(function* (
      closed: boolean,
    ) {
      if (closed === (yield* SubscriptionRef.get(readerClosed))) return;
      yield* SubscriptionRef.set(readerClosed, closed);
      yield* Effect.logDebug("Zotero reader presence changed").pipe(
        Effect.annotateLogs({ closed }),
      );
    });

    function dispatch(event: NotifyEvent): void {
      switch (event.event) {
        case "db/updated":
          PubSub.publishUnsafe(dbUpdated, event);
          break;
        case "reader/annot-select":
        case "reader/active": {
          const target: ReaderTarget = {
            itemID: event.itemID,
            attachmentID: event.attachmentID,
            selected: event.selected,
          };
          run(SubscriptionRef.set(readerTarget, target));
          run(setReaderClosed(false));
          break;
        }
        case "reader/inactive":
          run(setReaderClosed(true));
          break;
      }
    }

    const listen = (port: number): Effect.Effect<BindResult> =>
      Effect.callback<BindResult>((resume) => {
        let bound = false;
        try {
          const listener = serve(
            {
              fetch: app.fetch,
              port,
              hostname,
              overrideGlobalObjects: false,
            },
            (info) => {
              bound = true;
              run(
                Effect.logInfo("Server listening").pipe(
                  Effect.annotateLogs({
                    address: info.address,
                    port: info.port,
                  }),
                ),
              );
              resume(Effect.succeed({ server: listener, port: info.port }));
            },
          );
          listener.on("error", (error: NodeJS.ErrnoException) => {
            if (!bound) {
              bound = true;
              if (error.code === "EADDRINUSE") {
                run(
                  Effect.logDebug("Port taken, trying the next one").pipe(
                    Effect.annotateLogs({ port }),
                  ),
                );
                resume(Effect.succeed("in-use"));
              } else {
                run(
                  Effect.logError("Failed to bind server").pipe(
                    Effect.annotateLogs({ port, error }),
                  ),
                );
                resume(Effect.succeed("failed"));
              }
              return;
            }
            if (server !== listener) return;
            run(
              Effect.gen(function* () {
                yield* SubscriptionRef.set(boundPort, null);
                yield* refreshAvailability();
                yield* Effect.logError("Server error").pipe(
                  Effect.annotateLogs({ error }),
                );
              }),
            );
          });
        } catch (error) {
          run(
            Effect.logError("Failed to start server").pipe(
              Effect.annotateLogs({ port, error }),
            ),
          );
          resume(Effect.succeed("failed"));
        }
      });

    const startServer = Effect.fn("LocalServer.startServer")(function* () {
      for (let offset = 0; offset < PORT_RANGE; offset++) {
        const candidate = port + offset;
        if (candidate > MAX_PORT) break;
        const result = yield* listen(candidate);
        if (result === "in-use") continue;
        if (result === "failed") return;
        server = result.server;
        yield* SubscriptionRef.set(boundPort, result.port);
        yield* refreshAvailability();
        return;
      }
      yield* Effect.logError("No free port for the local server").pipe(
        Effect.annotateLogs({ port, range: PORT_RANGE }),
      );
    });

    const stopServer = Effect.fn("LocalServer.stopServer")(function* () {
      const current = server;
      const wasBound = (yield* SubscriptionRef.get(boundPort)) !== null;
      server = null;
      if (wasBound) yield* SubscriptionRef.set(boundPort, null);
      yield* refreshAvailability();
      if (!current) return;
      yield* Effect.callback<void, Error>((resume) => {
        current.close((error) => {
          resume(error ? Effect.fail(error) : Effect.void);
        });
      });
      yield* Effect.logInfo("Server stopped");
    });

    const reconcile = Effect.gen(function* () {
      yield* stopServer();
      if (enabled) yield* startServer();
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logError("Failed to reconcile server", cause),
      ),
      Effect.uninterruptible,
    );

    const noteStatus: NoteStatusSource = {
      getIndexedItemKeys: () => run(noteIndex.getIndexedItemKeys),
      whenIndexed: async () => {
        if (stoppedFlag) return false;
        return valueOr(
          await runPromiseExit(Effect.as(noteIndex.whenIndexed, true)),
          false,
        );
      },
    };

    app.route(
      "/",
      createLiveUpdateApp({
        enabled: () => liveUpdateEnabled,
        acceptedSourceIds: () => run(zoteroPref.current).acceptedSourceIds,
        refusedForSource: () =>
          run(Effect.asVoid(notifier.show(m.notice_needs_local_zotero()))),
        localItemIds: () =>
          Option.isNone(librarySource) || librarySource.value.active === "file",
        noteIndex: noteStatus,
        onNotify: dispatch,
        onUpdateMany: (event) => void PubSub.publishUnsafe(updateMany, event),
        onImportNotes: (event) => void PubSub.publishUnsafe(importNotes, event),
      }),
    );

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stoppedFlag = true;
        yield* stopServer().pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Failed to stop server", cause),
          ),
        );
        yield* PubSub.shutdown(available.pubsub);
        yield* PubSub.shutdown(boundPort.pubsub);
        yield* PubSub.shutdown(readerTarget.pubsub);
        yield* PubSub.shutdown(readerClosed.pubsub);
        yield* PubSub.shutdown(dbUpdated);
        yield* PubSub.shutdown(updateMany);
        yield* PubSub.shutdown(importNotes);
      }),
    );

    const onSettingsChanged = Effect.fn("LocalServer.onSettingsChanged")(
      function* (value: Readonly<Settings>) {
        const nextEnabled = value["server.enabled"];
        const nextLiveUpdate = value["server.live-update"];
        const nextPort = value["server.port"];
        const nextHostname = value["server.hostname"];
        const rebind =
          nextEnabled !== enabled ||
          nextPort !== port ||
          nextHostname !== hostname;
        if (!rebind && nextLiveUpdate === liveUpdateEnabled) return;
        enabled = nextEnabled;
        liveUpdateEnabled = nextLiveUpdate;
        port = nextPort;
        hostname = nextHostname;
        if (rebind) yield* reconcile;
        else yield* refreshAvailability();
      },
    );

    yield* forkEach(settings.changes, (value) => onSettingsChanged(value));

    return LocalServer.of({
      available: SubscriptionRef.get(available),
      availableChanges: SubscriptionRef.changes(available),
      effectivePort: SubscriptionRef.get(boundPort),
      effectivePortChanges: SubscriptionRef.changes(boundPort),
      readerTarget: SubscriptionRef.get(readerTarget),
      readerTargetChanges: SubscriptionRef.changes(readerTarget),
      readerClosed: SubscriptionRef.get(readerClosed),
      readerClosedChanges: SubscriptionRef.changes(readerClosed),
      dbUpdated: Stream.fromPubSub(dbUpdated),
      updateManyRequests: Stream.fromPubSub(updateMany),
      importNotesRequests: Stream.fromPubSub(importNotes),
    });
  }).pipe(withLogCategory("local-server")),
);
