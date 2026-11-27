import { Duration, Effect, Option } from "effect";

import type { CslItemData } from "@zotlit/db";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";
import {
  parseJson,
  exchangeWithZotero,
  ZoteroHttp,
  zoteroOrigin,
} from "@zotlit/plugin-kernel/zotero-http.ts";
import type { ZoteroRequest } from "@zotlit/plugin-kernel/zotero-http.ts";
import { ZOTERO_HTTP_PORT_PREF } from "@zotlit/plugin-services/desktop/zotero-pref/prefs-file.ts";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

export const LOCAL_API_PREF = "httpServer.localAPI.enabled";

const JSON_RPC_PATH = "/better-bibtex/json-rpc";

const ZOTERO_ANSWER_TIMEOUT = Duration.seconds(30);

const BETTER_CSL_JSON = "f4b52ab0-f878-4556-85a0-c7aeedd09dfc";

export type BibliographySource = "better-bibtex" | "local-api";

export interface BibliographyItemRef {
  itemKey: string;
  libraryID: number;
  groupID: number | null;
}

export interface BibliographyPorts {
  httpPort: number | null;
  localApiEnabled: boolean;
  localLibraryIDs?: boolean;
}

export type BibliographyFailure =
  | { code: "zotero-port-automatic"; pref: string }
  | { code: "zotero-unreachable"; port: number }
  | { code: "zotero-timeout"; seconds: number }
  | { code: "local-api-disabled"; pref: string }
  | { code: "source-failed"; source: BibliographySource; detail: string }
  | { code: "items-missing"; source: BibliographySource; indexedKeys: string[] }
  | { code: "citation-key-missing"; indexedKeys: string[] };

export type BibliographyResult =
  | {
      source: BibliographySource | null;
      items: ReadonlyMap<string, CslItemData>;
    }
  | { error: BibliographyFailure };

export const fetchBibliography = Effect.fn("Bibliography.fetchBibliography")(
  function* (
    refs: readonly BibliographyItemRef[],
    ports: BibliographyPorts,
  ): Effect.fn.Return<BibliographyResult, never, ZoteroHttp> {
    if (refs.length === 0) return { source: null, items: new Map() };
    if (ports.httpPort === null) {
      return {
        error: { code: "zotero-port-automatic", pref: ZOTERO_HTTP_PORT_PREF },
      };
    }

    const resolvedPorts = { ...ports, httpPort: ports.httpPort };
    if (ports.localLibraryIDs === false) {
      yield* Effect.logDebug(
        "The online library is the source; the bibliography comes from the local API by key",
      );
      return yield* fromLocalApi(refs, resolvedPorts);
    }

    const probe = yield* callJsonRpc(resolvedPorts, "api.ready", []);
    if (probe.ok) return yield* fromBetterBibtex(refs, resolvedPorts);
    if (probe.reason === "unreachable") {
      return { error: zoteroUnreachable(ports.httpPort) };
    }
    if (probe.reason === "timeout") return { error: zoteroTimeout() };
    yield* Effect.logDebug(
      "Better BibTeX did not answer; falling back to the local API",
    );
    return yield* fromLocalApi(refs, resolvedPorts);
  },
  withLogCategory("pandoc", "bibliography"),
);

type ResolvedBibliographyPorts = BibliographyPorts & { httpPort: number };

const fromBetterBibtex = Effect.fn("Bibliography.fromBetterBibtex")(
  function* (
    refs: readonly BibliographyItemRef[],
    ports: ResolvedBibliographyPorts,
  ): Effect.fn.Return<BibliographyResult, never, ZoteroHttp> {
    const lookup = yield* callJsonRpc(ports, "item.citationkey", [
      refs.map(rpcItemKey),
    ]);
    if (!lookup.ok) return { error: rpcFailure(lookup, ports.httpPort) };

    const table = asRecord(lookup.result);
    const cited: { ref: BibliographyItemRef; citationKey: string }[] = [];
    const keyless: string[] = [];
    for (const ref of refs) {
      const citationKey = table[rpcItemKey(ref)];
      if (typeof citationKey === "string" && citationKey) {
        cited.push({ ref, citationKey });
      } else {
        keyless.push(indexedKeyOf(ref));
      }
    }
    if (keyless.length > 0) {
      return { error: { code: "citation-key-missing", indexedKeys: keyless } };
    }

    const entries = new Map<string, CslItemData>();
    for (const [libraryID, group] of groupBy(cited, (c) => c.ref.libraryID)) {
      const exported = yield* callJsonRpc(ports, "item.export", [
        group.map((c) => c.citationKey),
        BETTER_CSL_JSON,
        libraryID,
      ]);
      if (!exported.ok) {
        return { error: rpcFailure(exported, ports.httpPort) };
      }
      for (const item of asCslItems(exported.result)) {
        entries.set(citationAddress(libraryID, item.id), item);
      }
    }

    return join(
      "better-bibtex",
      cited.map((c) => [
        indexedKeyOf(c.ref),
        entries.get(citationAddress(c.ref.libraryID, c.citationKey)),
      ]),
    );
  },
  withLogCategory("pandoc", "bibliography"),
);

const fromLocalApi = Effect.fn("Bibliography.fromLocalApi")(
  function* (
    refs: readonly BibliographyItemRef[],
    ports: ResolvedBibliographyPorts,
  ): Effect.fn.Return<BibliographyResult, never, ZoteroHttp> {
    if (!ports.localApiEnabled) return { error: localApiDisabled() };

    const entries = new Map<string, CslItemData>();
    for (const [groupID, group] of groupBy(refs, (ref) => ref.groupID)) {
      const query = new URLSearchParams({
        itemKey: group.map((ref) => ref.itemKey).join(","),
        include: "csljson",
      });
      const library = groupID === null ? "users/0" : `groups/${groupID}`;
      const response = yield* send({
        port: ports.httpPort,
        path: `/api/${library}/items?${query.toString()}`,
        method: "GET",
      });
      if (response === "unreachable")
        return { error: zoteroUnreachable(ports.httpPort) };
      if (response === "timeout") return { error: zoteroTimeout() };
      if (response.status === 403) return { error: localApiDisabled() };
      if (response.status !== 200) {
        return {
          error: {
            code: "source-failed",
            source: "local-api",
            detail: `${response.status} ${response.text.trim()}`,
          },
        };
      }
      for (const entry of asArray(parseJson(response.text))) {
        const key = asRecord(entry)["key"];
        if (typeof key !== "string") continue;
        const [item] = asCslItems(asRecord(entry)["csljson"]);
        if (item) entries.set(formatIndexedKey(key, groupID), item);
      }
    }

    return join(
      "local-api",
      refs.map((ref) => [indexedKeyOf(ref), entries.get(indexedKeyOf(ref))]),
    );
  },
  withLogCategory("pandoc", "bibliography"),
);

function join(
  source: BibliographySource,
  resolved: readonly (readonly [
    indexedKey: string,
    item: CslItemData | undefined,
  ])[],
): BibliographyResult {
  const items = new Map<string, CslItemData>();
  const missing: string[] = [];
  for (const [indexedKey, item] of resolved) {
    if (item) items.set(indexedKey, item);
    else missing.push(indexedKey);
  }
  return missing.length > 0
    ? { error: { code: "items-missing", source, indexedKeys: missing } }
    : { source, items };
}

type RpcOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: "unreachable" }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "absent" }
  | { ok: false; reason: "error"; message: string };

const callJsonRpc = Effect.fn("Bibliography.callJsonRpc")(
  function* (
    ports: ResolvedBibliographyPorts,
    method: string,
    params: readonly unknown[],
  ): Effect.fn.Return<RpcOutcome, never, ZoteroHttp> {
    const response = yield* send({
      port: ports.httpPort,
      path: JSON_RPC_PATH,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    if (response === "unreachable" || response === "timeout")
      return { ok: false, reason: response };
    if (response.status !== 200) return { ok: false, reason: "absent" };

    const body = asRecord(parseJson(response.text));
    if ("result" in body) return { ok: true, result: body["result"] };
    if (!("error" in body)) return { ok: false, reason: "absent" };
    const message = asRecord(body["error"])["message"];
    return {
      ok: false,
      reason: "error",
      message: typeof message === "string" ? message : "Unknown error",
    };
  },
  withLogCategory("pandoc", "bibliography"),
);

function rpcFailure(
  outcome: Extract<RpcOutcome, { ok: false }>,
  httpPort: number,
): BibliographyFailure {
  if (outcome.reason === "unreachable") return zoteroUnreachable(httpPort);
  if (outcome.reason === "timeout") return zoteroTimeout();
  return {
    code: "source-failed",
    source: "better-bibtex",
    detail:
      outcome.reason === "error"
        ? outcome.message
        : "Better BibTeX stopped answering its JSON-RPC endpoint",
  };
}

const send = Effect.fnUntraced(function* (request: ZoteroRequest) {
  const http = yield* ZoteroHttp;
  const url = `${zoteroOrigin(request.port)}${request.path}`;
  const answer = yield* exchangeWithZotero(http, request).pipe(
    Effect.catchTag("HttpClientError", (error) =>
      Effect.as(
        Effect.logDebug("Zotero's HTTP server did not answer").pipe(
          Effect.annotateLogs({ url, error }),
        ),
        "unreachable" as const,
      ),
    ),
    Effect.timeoutOption(ZOTERO_ANSWER_TIMEOUT),
  );
  if (Option.isSome(answer)) return answer.value;
  yield* Effect.logDebug("Zotero gave no answer in time").pipe(
    Effect.annotateLogs({ url }),
  );
  return "timeout" as const;
});

function zoteroUnreachable(port: number): BibliographyFailure {
  return { code: "zotero-unreachable", port };
}

function zoteroTimeout(): BibliographyFailure {
  return {
    code: "zotero-timeout",
    seconds: Duration.toSeconds(ZOTERO_ANSWER_TIMEOUT),
  };
}

function localApiDisabled(): BibliographyFailure {
  return { code: "local-api-disabled", pref: LOCAL_API_PREF };
}

function rpcItemKey(ref: BibliographyItemRef): string {
  return `${ref.libraryID}:${ref.itemKey}`;
}

function citationAddress(libraryID: number, citationKey: string): string {
  return `${libraryID}:${citationKey}`;
}

function indexedKeyOf(ref: BibliographyItemRef): string {
  return formatIndexedKey(ref.itemKey, ref.groupID);
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function asCslItems(value: unknown): CslItemData[] {
  return typeof value === "string"
    ? asArray(parseJson(value)).filter(isCslItem)
    : [];
}

function isCslItem(value: unknown): value is CslItemData {
  return typeof asRecord(value)["id"] === "string";
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
