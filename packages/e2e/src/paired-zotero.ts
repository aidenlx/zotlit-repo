import { expect } from "vitest";

import { openRdpSession } from "@zotlit/scripts/zotero-rdp";

import { waitFor } from "./obsidian-cli.ts";

const ALLOWED_REQUEST = { "Zotero-Allowed-Request": "1" } as const;

export interface ZoteroRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export function zoteroFetch(
  baseUrl: string,
  path: string,
  request: ZoteroRequest = {},
): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method: request.method ?? "GET",
    headers: { ...ALLOWED_REQUEST, ...request.headers },
    ...(request.body === undefined ? {} : { body: request.body }),
  });
}

export async function waitForBetterBibtex(
  baseUrl: string,
  timeoutMs = 60_000,
): Promise<void> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method: "api.ready",
    params: [],
    id: 1,
  });
  const end = performance.now() + timeoutMs;
  let last = "no answer";
  while (performance.now() < end) {
    const reply = await zoteroFetch(baseUrl, "/better-bibtex/json-rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch((error: unknown) => error);
    if (reply instanceof Response) {
      if (reply.status === 200) return;
      last = `${reply.status}`;
    } else last = String(reply);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Better BibTeX did not answer api.ready within ${timeoutMs} ms (last: ${last})`,
  );
}

export async function readServerID(baseUrl: string): Promise<string> {
  const reply = await zoteroFetch(baseUrl, "");
  const id = reply.headers.get("Zotero-Server-ID");
  if (!id) throw new Error("Zotero answered no Zotero-Server-ID");
  return id;
}

export interface AuthorizeReply {
  status: number;
  body: unknown;
}

export async function authorize(
  baseUrl: string,
  options: { serverID: string; appName: string },
): Promise<AuthorizeReply> {
  const reply = await zoteroFetch(baseUrl, "local/authorize", {
    method: "POST",
    headers: {
      "Zotero-Server-ID": options.serverID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ appName: options.appName }),
  });
  const text = await reply.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // A refusal answers text/plain; the raw text is the whole oracle then.
  }
  return { status: reply.status, body };
}

export interface Grant {
  key: string;
  remember: boolean;
}

export function isGrant(body: unknown): body is Grant {
  if (typeof body !== "object" || body === null) return false;
  const { key, remember } = body as Record<string, unknown>;
  return typeof key === "string" && typeof remember === "boolean";
}

export interface ZoteroRdp extends Disposable {
  json<T>(body: string): Promise<T>;
}

export async function openZoteroRdp(port: number): Promise<ZoteroRdp> {
  const session = await openRdpSession(port);
  return {
    async json<T>(body: string): Promise<T> {
      const packet = await session.evaluateAsync(body);
      const result = packet.result;
      if (typeof result !== "string") {
        throw new Error(
          `Zotero returned no result: ${JSON.stringify(
            packet.exceptionMessage ?? packet.exception ?? packet.result,
          )}`,
        );
      }
      if (result.startsWith("ERR:")) {
        throw new Error(`Zotero threw: ${result.slice("ERR:".length)}`);
      }
      return JSON.parse(result) as T;
    },
    [Symbol.dispose]() {
      session[Symbol.dispose]();
    },
  };
}

export async function resetAuthorizations(rdp: ZoteroRdp): Promise<void> {
  await rdp.json(`(async () => {
    Zotero.Server.LocalAPI._resetAuthorizeRateLimit();
    await Zotero.Server.LocalAPI.clearAuthorizations();
    return "ok";
  })()`);
}

export function authorizationCount(rdp: ZoteroRdp): Promise<number> {
  return rdp.json<number>("Zotero.Server.LocalAPI.getAuthorizationCount()");
}

export async function grantRememberedKey(
  baseUrl: string,
  rdp: ZoteroRdp,
  options: { serverID: string; appName: string },
): Promise<string> {
  await resetAuthorizations(rdp);
  await stubPrompt(rdp, { allow: true, remember: true });
  try {
    const reply = await authorize(baseUrl, options);
    if (reply.status !== 200 || !isGrant(reply.body)) {
      throw new Error(
        `Zotero refused a scripted Always Allow: ${reply.status}`,
      );
    }
    const held = await authorizationCount(rdp);
    if (held !== 1) {
      throw new Error(`Zotero holds ${held} remembered keys, not one`);
    }
    return reply.body.key;
  } finally {
    await restorePrompt(rdp);
  }
}

export interface PromptOutcome {
  allow: boolean;
  remember: boolean;
}

export async function stubPrompt(
  rdp: ZoteroRdp,
  outcome: PromptOutcome,
): Promise<void> {
  await rdp.json(`(() => {
    const local = Zotero.Server.LocalAPI;
    if (!local.__zlOriginalPrompt) {
      local.__zlOriginalPrompt = local._promptForAuthorization;
    }
    local.__zlOutcome = ${JSON.stringify(outcome)};
    local._promptForAuthorization = async () => local.__zlOutcome;
    return "stubbed";
  })()`);
}

export function restorePrompt(
  rdp: ZoteroRdp,
): Promise<{ original: boolean; leftovers: string[] }> {
  return rdp.json(`(() => {
    const local = Zotero.Server.LocalAPI;
    if (local.__zlOriginalPrompt) {
      local._promptForAuthorization = local.__zlOriginalPrompt;
      delete local.__zlOriginalPrompt;
    }
    delete local.__zlOutcome;
    return {
      original: String(local._promptForAuthorization).includes("Zotero.Prompt"),
      leftovers: Object.keys(local).filter((name) => name.startsWith("__zl")),
    };
  })()`);
}

export type DialogButton = "accept" | "cancel" | "extra1";

const DIALOG_URL = "chrome://global/content/commonDialog.xhtml";

const FIND_DIALOG = `(() => {
  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    const candidate = windows.getNext();
    const dialog = candidate.document?.getElementById("commonDialog");
    if (candidate.location?.href === ${JSON.stringify(DIALOG_URL)}
      && dialog?.defaultButton === "extra1"
      && ["accept", "cancel", "extra1"].every(button => !dialog.getButton(button).hidden)) {
      return candidate;
    }
  }
  return null;
})()`;

export function waitForAuthorizationDialog(
  rdp: ZoteroRdp,
  tries = 60,
): Promise<boolean> {
  return waitFor(() => rdp.json<boolean>(`Boolean(${FIND_DIALOG})`), tries);
}

export async function clickAuthorizationDialog(
  rdp: ZoteroRdp,
  button: DialogButton,
): Promise<void> {
  const clicked = await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    // A Zotero dialog over RDP: the Obsidian page helpers do not reach it.
    dialog.document.getElementById("commonDialog").getButton(${JSON.stringify(button)}).click();
    return true;
  })()`);
  if (!clicked) throw new Error("No authorization dialog was open to click");
}

export async function dismissAuthorizationDialog(
  rdp: ZoteroRdp,
): Promise<void> {
  const closed = await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    dialog.close();
    return true;
  })()`);
  if (!closed) throw new Error("No authorization dialog was open to dismiss");
}

export async function denyAnyAuthorizationDialog(
  rdp: ZoteroRdp,
): Promise<boolean> {
  return await rdp.json<boolean>(`(() => {
    const dialog = ${FIND_DIALOG};
    if (!dialog) return false;
    // Teardown in a Zotero dialog over RDP, not a reader's press.
    dialog.document.getElementById("commonDialog").getButton("extra1").click();
    return true;
  })()`);
}

export interface ReaderAnnotation {
  rdp: ZoteroRdp;
  attachmentKey: string;
  annotationKey: string;
}

function openReader(attachmentKey: string): string {
  return `(() => {
    const attachment = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(attachmentKey)},
    );
    return Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
  })()`;
}

export function readerAnnotation({
  rdp,
  attachmentKey,
  annotationKey,
}: ReaderAnnotation): Promise<{
  position: string;
  text: string | null;
} | null> {
  return rdp.json(`(() => {
    const annotation = ${openReader(attachmentKey)}?._item
      .getAnnotations()
      .find(({ key }) => key === ${JSON.stringify(annotationKey)});
    return annotation
      ? {
          position: annotation.annotationPosition,
          text: annotation.annotationText ?? null,
        }
      : null;
  })()`);
}

export async function readerSettled(
  annotation: ReaderAnnotation,
  { api, serverID, image }: { api: string; serverID: string; image: boolean },
): Promise<void> {
  const { rdp, attachmentKey, annotationKey } = annotation;
  const key = JSON.stringify(annotationKey);
  const readerPending = () =>
    rdp.json<string[]>(`(async () => {
      const reader = ${openReader(attachmentKey)};
      const item = reader
        ? Zotero.Items.getByLibraryAndKey(reader._item.libraryID, ${key})
        : null;
      const manager = reader?._internalReader?._annotationManager;
      if (!item || !manager) return ["reader"];
      // The Reader's annotations live in its content window, so they are read
      // by index rather than handed a chrome callback.
      let held = null;
      for (let index = 0; index < manager._annotations.length; index++) {
        const candidate = manager._annotations[index];
        if (candidate.id === ${key}) held = candidate;
      }
      if (!held) return ["annotation"];
      const canonical = (position) =>
        JSON.stringify(position, Object.keys(position).sort());
      // Zotero stores "YYYY-MM-DD hh:mm:ss" in UTC; the Reader holds ISO.
      const modified = item.dateModified.replace(" ", "T") + "Z";
      const rendered = reader._internalReader._primaryView?._pdfRenderer
        ?._lastRendered.get(${key});
      const image = ${JSON.stringify(image)};
      return Object.entries({
        position:
          canonical(held.position) !==
          canonical(JSON.parse(item.annotationPosition)),
        modified: held.dateModified !== modified,
        unsaved: manager._unsavedAnnotations.size > 0,
        saving: !!manager._savingInProgress,
        image: image && !held.image,
        rendered:
          image && rendered !== undefined && rendered !== held.dateModified,
        cache: image && !(await Zotero.Annotations.hasCacheImage(item)),
      })
        .filter(([, pending]) => pending)
        .map(([name]) => name);
    })()`);
  const version = async () =>
    (
      (await (
        await zoteroFetch(api, `users/0/items/${annotationKey}`, {
          headers: { "Zotero-Server-ID": serverID },
        })
      ).json()) as { version: number }
    ).version;
  let seen: number | null = null;
  let pending: string[] = [];
  const settled = await waitFor(async () => {
    pending = await readerPending();
    if (pending.length > 0) {
      seen = null;
      return false;
    }
    const now = await version();
    const still = now === seen;
    seen = now;
    return still;
  }, 120);
  if (!settled) {
    const scene = await rdp
      .json<unknown>(
        `(async () => {
      const reader = ${openReader(attachmentKey)};
      const main = Zotero.getMainWindow();
      const started = Date.now();
      // The 50 ms timer measures the main window's timer lag, not a wait.
      await new Promise((resolve) => main.setTimeout(resolve, 50));
      return {
        timerLagMs: Date.now() - started - 50,
        bounds: [main.screenX, main.screenY, main.outerWidth, main.outerHeight],
        selectedTab: main.Zotero_Tabs.selectedID,
        readerTab: reader?.tabID ?? null,
        mainVisibility: main.document.visibilityState,
        readerVisibility: reader?._iframeWindow?.document.visibilityState ?? null,
        readers: Zotero.Reader._readers.map((candidate) => candidate.tabID),
        rendered: [...(reader?._internalReader?._primaryView?._pdfRenderer?._lastRendered.keys() ?? [])],
      };
    })()`,
      )
      .catch((error: unknown) => String(error));
    throw new Error(
      `the Zotero Reader never settled on ${annotationKey}: ${pending.join(", ") || "version moving"}; ${JSON.stringify(scene)}`,
    );
  }
  if (image) {
    await rdp.json<boolean>(`(async () => {
      const item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${key});
      while (Zotero.Date.dateToSQL(new Date(), true) <= item.dateModified) {
        await Zotero.Promise.delay(50);
      }
      return true;
    })()`);
  }
}

export function heldAnnotationKeys(
  rdp: ZoteroRdp,
  item: string,
): Promise<string[]> {
  return rdp.json<string[]>(`${item}.getAnnotations().map(({ key }) => key)`);
}

export async function freshAnnotationKey(
  rdp: ZoteroRdp,
  {
    item,
    before,
    created,
  }: {
    item: string;
    before: readonly string[];
    created?: (keys: readonly string[]) => void;
  },
): Promise<string> {
  let fresh: string[] = [];
  expect(
    await waitFor(async () => {
      fresh = (await heldAnnotationKeys(rdp, item)).filter(
        (key) => !before.includes(key),
      );
      return fresh.length > 0;
    }),
  ).toBe(true);
  created?.(fresh);
  expect(fresh).toHaveLength(1);
  return fresh[0]!;
}

export interface StoredAnnotation {
  annotationType: string;
  annotationColor: string;
  annotationComment: string;
  annotationPosition: string;
  annotationPageLabel: string;
  annotationSortIndex: string;
}

export async function storedAnnotation(
  baseUrl: string,
  serverID: string,
  key: string,
): Promise<StoredAnnotation> {
  const reply = await zoteroFetch(baseUrl, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  return ((await reply.json()) as { data: StoredAnnotation }).data;
}

export async function eraseAnnotations(
  rdp: ZoteroRdp,
  keys: readonly string[],
): Promise<void> {
  await rdp.json(`(async () => {
    for (const key of ${JSON.stringify(keys)}) {
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      );
      if (item) await item.eraseTx();
    }
    return "erased";
  })()`);
}
