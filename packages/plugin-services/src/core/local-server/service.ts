// The Local Server every hosted service mounts on, and the requests it hands
// on. A desktop host builds it over a Node listener (`layerLocalServer`).
import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { DbUpdated, ImportMode, UpdateScope } from "@zotlit/protocol";

/**
 * Live state of the Zotero reader, derived from the companion's reader pushes.
 * The service is the authoritative holder; views sync from {@link
 * LocalServer.readerTarget} on mount and {@link LocalServer.readerTargetChanges}
 * thereafter.
 */
export interface ReaderTarget {
  /** Parent (regular) item the open attachment belongs to. */
  itemID: number;
  /** The open attachment item. */
  attachmentID: number;
  /** Item IDs of the annotations currently selected in the reader. */
  selected: readonly number[];
}

export interface UpdateManyRequest {
  readonly items: number[];
  readonly scope: UpdateScope;
  readonly profileId?: string;
}

export interface ImportNotesRequest {
  readonly items: number[];
  readonly mode: ImportMode;
}

/**
 * The plugin's one loopback HTTP listener on this desktop — the Local Server.
 *
 * It owns a single Hono app and a single `serve` call. Live Update's routes
 * are mounted on it at construction and answer only while Live Update's own
 * toggle is on, so the listener's own toggle is what opens the port.
 *
 * Start/stop and rebinding follow the `server.*` settings; lifecycle
 * transitions are serialized so a port change can't race a half-closed server.
 */
export class LocalServer extends Context.Service<
  LocalServer,
  {
    /** `true` only while Live Update is on and the listener accepts connections. */
    readonly available: Effect.Effect<boolean>;
    /**
     * Edge transitions of {@link available} — fired when the listener starts
     * answering Live Update or stops (either toggle off, a port rebind, or a
     * bind error). Consumers gate reader-follow features on this.
     */
    readonly availableChanges: Stream.Stream<boolean>;
    /**
     * The port the listener is bound to, or `null` while it is down. It differs
     * from the `server.port` setting when that port was busy — see
     * {@link PORT_RANGE}.
     */
    readonly effectivePort: Effect.Effect<number | null>;
    /**
     * The port the listener is bound to, or `null` once it stops. Fires on
     * every bind and every close, so a settings row can show the effective port
     * without polling.
     */
    readonly effectivePortChanges: Stream.Stream<number | null>;
    /**
     * Latest reader state pushed by the companion; `null` until the first push.
     * It is held past a closed reader and past a listener that stopped
     * answering, so a surface following the Zotero reader keeps the attachment
     * it last had open rather than emptying.
     */
    readonly readerTarget: Effect.Effect<ReaderTarget | null>;
    /**
     * Aggregated reader state: emitted whenever the companion reports a reader
     * switch or a selection change, carrying the new {@link ReaderTarget}.
     * Consumers diff `attachmentID` to tell a document switch from a re-select.
     */
    readonly readerTargetChanges: Stream.Stream<ReaderTarget | null>;
    /**
     * `true` while the companion's last word was that the focused Zotero tab or
     * window is no longer a reader. {@link readerTarget} still names the
     * attachment that reader had open.
     */
    readonly readerClosed: Effect.Effect<boolean>;
    /**
     * Edge transitions of {@link readerClosed}: `true` once the companion
     * reports that the focused Zotero tab or window is no longer a reader,
     * `false` again on the next reader push. The held {@link readerTarget}
     * stays put either way, so a surface can keep the last attachment on
     * screen and say that the reader closed.
     */
    readonly readerClosedChanges: Stream.Stream<boolean>;
    /**
     * The companion's Freshness Signal: the Zotero database changed and the
     * main database file is as current as the companion can make it.
     * Payload-free by design — subscribers treat it as a refresh trigger,
     * never as data.
     */
    readonly dbUpdated: Stream.Stream<DbUpdated>;
    /**
     * A batch literature-note update requested over `PUT /literature-notes` —
     * the companion's fallback when the id list is too long for an `obsidian://`
     * URL. Carries the raw item ids; the subscriber owns resolution and the
     * modal.
     */
    readonly updateManyRequests: Stream.Stream<UpdateManyRequest>;
    /**
     * A batch note-import requested over `PUT /zotero-notes` — the companion's
     * fallback when the id list is too long for an `obsidian://` URL.
     */
    readonly importNotesRequests: Stream.Stream<ImportNotesRequest>;
  }
>()("zotlit/local-server/LocalServer") {}
