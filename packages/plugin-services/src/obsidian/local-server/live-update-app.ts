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
  SOURCE_MISMATCH_STATUS,
} from "@zotlit/protocol";
import type {
  ImportMode,
  NotifyEvent,
  NoteStatusResponse,
  UpdateScope,
} from "@zotlit/protocol";

import { rejectIncompatibleProtocol } from "./protocol-compat.ts";

function senderDirs(event: NotifyEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.profilePath !== undefined) out.profilePath = event.profilePath;
  if (event.dataPath !== undefined) out.dataPath = event.dataPath;
  return out;
}

export interface NoteStatusSource {
  whenIndexed(): Promise<boolean>;
  getIndexedItemKeys(): string[];
}

export interface LiveUpdateAppDeps {
  enabled(): boolean;
  acceptedSourceIds(): readonly string[];
  noteIndex: NoteStatusSource;
  onNotify(event: NotifyEvent): void;
  onUpdateMany(event: {
    items: number[];
    scope: UpdateScope;
    profileId?: string;
  }): void;
  onImportNotes(event: { items: number[]; mode: ImportMode }): void;
}

const LIVE_UPDATE_PATHS = [
  "/notify",
  "/literature-notes",
  "/zotero-notes",
] as const;

export function createLiveUpdateApp(deps: LiveUpdateAppDeps): Hono {
  const app = new Hono();

  const gateEnabled = async (
    c: Context,
    next: Next,
  ): Promise<Response | void> => {
    if (!deps.enabled()) return c.body(null, 404);
    await next();
  };
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
  const gateSourceId = async (
    c: Context,
    next: Next,
  ): Promise<Response | void> => {
    const expected = deps.acceptedSourceIds();
    const received = c.req.header(SOURCE_ID_HEADER);
    if (received === undefined || !expected.includes(received)) {
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Discarded request: source id mismatch").pipe(
          Effect.annotateLogs({
            expected,
            received,
          }),
          withLogCategory("live-update"),
        ),
      );
      return c.body(
        null,
        c.req.method === "PUT" ? SOURCE_MISMATCH_STATUS : 204,
      );
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
