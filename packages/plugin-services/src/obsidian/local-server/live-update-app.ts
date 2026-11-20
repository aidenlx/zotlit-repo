// The Live Update service's routes on the Local Server: gates + routes, no
// server lifecycle. The gates are scoped to the three Companion paths so a
// service mounted beside these routes keeps its own gates.
import { vValidator } from "@hono/valibot-validator";
import { Effect } from "effect";
import type { Context, Next } from "hono";
import { Hono } from "hono/tiny";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { yieldToMain } from "@zotlit/plugin-kernel/yield-to-main.ts";
import {
  batchUpdateRequestSchema,
  importNotesRequestSchema,
  notifyEventSchema,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type {
  ImportMode,
  NotifyEvent,
  NoteStatusResponse,
  UpdateScope,
} from "@zotlit/protocol";

import { rejectIncompatibleProtocol } from "./protocol-compat.ts";

/** Sender's raw profile/data dirs, present only when its debug logging is on. */
function senderDirs(event: NotifyEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.profilePath !== undefined) out.profilePath = event.profilePath;
  if (event.dataPath !== undefined) out.dataPath = event.dataPath;
  return out;
}

/** The slice of {@link NoteIndex} the note-status query route reads. */
export interface NoteStatusSource {
  /** Resolves `true` once the first full scan ends, `false` when the server stops first. */
  whenIndexed(): Promise<boolean>;
  getIndexedItemKeys(): string[];
}

export interface LiveUpdateAppDeps {
  /** `false` while the Live updates toggle is off — every route answers 404. */
  enabled(): boolean;
  sourceId(): string | null;
  noteIndex: NoteStatusSource;
  onNotify(event: NotifyEvent): void;
  onUpdateMany(event: {
    items: number[];
    scope: UpdateScope;
    profileId?: string;
  }): void;
  onImportNotes(event: { items: number[]; mode: ImportMode }): void;
}

/** The paths the Companion talks to — the gates below cover exactly these. */
const LIVE_UPDATE_PATHS = [
  "/notify",
  "/literature-notes",
  "/zotero-notes",
] as const;

export function createLiveUpdateApp(deps: LiveUpdateAppDeps): Hono {
  const app = new Hono();

  /** Answer 404 while the Live updates toggle is off, whatever else the server hosts. */
  const gateEnabled = async (
    c: Context,
    next: Next,
  ): Promise<Response | void> => {
    if (!deps.enabled()) return c.body(null, 404);
    await next();
  };
  /** Reject a request whose `X-Zotlit-Protocol-Version` header is incompatible. */
  const gateProtocol = async (
    c: Context,
    next: Next,
  ): Promise<Response | void> => {
    if (
      rejectIncompatibleProtocol(
        c.req.header(PROTOCOL_VERSION_HEADER),
        "live-update",
        {
          transport: "http",
        },
      )
    ) {
      return c.body(null, 426);
    }
    await next();
  };
  /** Discard a request whose `X-Zotlit-Source-Id` isn't the configured install. */
  const gateSourceId = async (
    c: Context,
    next: Next,
  ): Promise<Response | void> => {
    const expected = deps.sourceId();
    const received = c.req.header(SOURCE_ID_HEADER);
    if (expected === null || received !== expected) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Discarded request: source id mismatch").pipe(
          Effect.annotateLogs({
            expected,
            received,
          }),
          withLogCategory("live-update"),
        ),
      );
      return c.body(null, 204);
    }
    await next();
  };
  for (const path of LIVE_UPDATE_PATHS) {
    app.use(path, gateEnabled, gateProtocol, gateSourceId);
  }

  app
    .post(
      "/notify",
      vValidator("json", notifyEventSchema, (result, c) => {
        if (result.success) return;
        Effect.runSyncWith(logServices)(
          Effect.logWarning("Received notify event failed validation").pipe(
            Effect.annotateLogs({
              issues: result.issues,
            }),
            withLogCategory("live-update"),
          ),
        );
        return c.json(result, 400);
      }),
      (c) => {
        const event = c.req.valid("json");
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Received notify event").pipe(
            Effect.annotateLogs({
              event: event.event,
              ...senderDirs(event),
            }),
            withLogCategory("live-update"),
          ),
        );
        deps.onNotify(event);
        return c.body(null, 204);
      },
    )
    // Fire-and-forget: the batch modal is interactive and long-running, so ack
    // 204 immediately and let the subscriber drive it; never await the batch.
    .put(
      "/literature-notes",
      vValidator("json", batchUpdateRequestSchema, (result, c) => {
        if (result.success) return;
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "Received literature-notes update failed validation",
          ).pipe(
            Effect.annotateLogs({
              issues: result.issues,
            }),
            withLogCategory("live-update"),
          ),
        );
        return c.json(result, 400);
      }),
      (c) => {
        const body = c.req.valid("json");
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Received literature-notes update").pipe(
            Effect.annotateLogs({
              items: body.items.length,
              scope: body.scope,
            }),
            withLogCategory("live-update"),
          ),
        );
        // Decouple from the event loop to avoid the handler from blocking
        // the main thread and let the response finish first.
        void yieldToMain().then(() => {
          deps.onUpdateMany({
            items: body.items,
            scope: body.scope,
            ...(body.profileId === undefined
              ? {}
              : { profileId: body.profileId }),
          });
        });
        return c.body(null, 204);
      },
    )
    .put(
      "/zotero-notes",
      vValidator("json", importNotesRequestSchema, (result, c) => {
        if (result.success) return;
        Effect.runSyncWith(logServices)(
          Effect.logWarning(
            "Received zotero-notes import failed validation",
          ).pipe(
            Effect.annotateLogs({
              issues: result.issues,
            }),
            withLogCategory("live-update"),
          ),
        );
        return c.json(result, 400);
      }),
      (c) => {
        const body = c.req.valid("json");
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Received zotero-notes import").pipe(
            Effect.annotateLogs({
              items: body.items.length,
              mode: body.mode,
            }),
            withLogCategory("live-update"),
          ),
        );
        void yieldToMain().then(() => {
          deps.onImportNotes({ items: body.items, mode: body.mode });
        });
        return c.body(null, 204);
      },
    )
    /**
     * Answers the companion's note-status query from the live Note Index's
     * Literature-Note key set. Awaits the index's first full scan so a
     * startup-time query never reports an empty vault. A server that stops
     * before the scan ends answers 404, as with Live updates off, so the
     * Companion keeps the status it has instead of a part of the vault.
     */
    .get("/literature-notes", async (c) => {
      if (!(await deps.noteIndex.whenIndexed())) return c.body(null, 404);
      const keys = deps.noteIndex.getIndexedItemKeys();
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Answered literature-notes status query").pipe(
          Effect.annotateLogs({
            keys: keys.length,
          }),
          withLogCategory("live-update"),
        ),
      );
      return c.json({ keys } satisfies NoteStatusResponse);
    });

  return app;
}
