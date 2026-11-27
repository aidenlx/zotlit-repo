import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { exportWebApiLibraries } from "@zotlit/db-testing/web-api";
import { FakeZoteroApi } from "@zotlit/web-library/fake-zotero-api";
import type {
  FakeItemInput,
  FakeRequest,
} from "@zotlit/web-library/fake-zotero-api";

import { obRun, obRunUntil } from "./obsidian-cli.ts";

export const MAIN_ACCOUNT = {
  userID: 7_700_001,
  username: "fixture-reader",
} as const;
export const SECOND_ACCOUNT = {
  userID: 7_700_002,
  username: "second-reader",
} as const;

export const DATED_ITEM = {
  key: "DATEDZL2",
  title: "Dates read in the language of Zotero",
  date: "01/02/2020",
} as const;
export const ONLINE_ITEM = {
  title: "Marginalia kept on a distant server",
  citationKey: "webwrightMarginalia2026",
  lastName: "Webwright",
  comment: "A comment that only the online library holds",
} as const;
export const DOOMED_ITEM = {
  key: "WTHDRZL2",
  title: "Withdrawn from the online library",
  date: "2019",
} as const;
export const GROUP_ITEM = {
  groupID: 4_200_309,
  key: "GRUPZL22",
  title: "Circulated among the online group",
  date: "2024",
} as const;
export const SECOND_ITEM = {
  key: "SECNDZL2",
  title: "A paper of the second account",
  citationKey: "secondAccount2025",
} as const;

export const READ_ALL = {
  user: { library: true, notes: true, files: true, write: false },
  groups: { all: { library: true, write: false } },
} as const;
export const GROUPS_ONLY = {
  groups: { all: { library: true, write: false } },
} as const;

function inventedKey(): string {
  return randomBytes(12).toString("hex");
}

function article(input: {
  key: string;
  title: string;
  date: string;
  lastName: string;
  citationKey?: string;
}): FakeItemInput {
  return {
    key: input.key,
    itemType: "journalArticle",
    title: input.title,
    date: input.date,
    ...(input.citationKey === undefined
      ? {}
      : { citationKey: input.citationKey }),
    creators: [
      { creatorType: "author", firstName: "Ola", lastName: input.lastName },
    ],
    tags: [],
    collections: [],
    relations: {},
    dateAdded: "2026-01-05T10:00:00Z",
    dateModified: "2026-01-05T10:00:00Z",
  };
}

export interface OnlineLibraryApi extends AsyncDisposable {
  readonly url: string;
  readonly main: FakeZoteroApi;
  readonly second: FakeZoteroApi;
  readonly keys: {
    readonly main: string;
    readonly second: string;
    readonly secondNoAccess: string;
    readonly unknown: string;
  };
  requests(): FakeRequest[];
  article: typeof article;
}

export async function startOnlineLibraryApi(
  databasePath: string,
): Promise<OnlineLibraryApi> {
  const main = new FakeZoteroApi(MAIN_ACCOUNT);
  const sqlite = new DatabaseSync(databasePath, { readOnly: true });
  try {
    main.loadLibraries(exportWebApiLibraries(sqlite, MAIN_ACCOUNT));
  } finally {
    sqlite.close();
  }
  main.user.putItem(article({ ...DATED_ITEM, lastName: "Datewright" }));
  main.user.putItem(article({ ...DOOMED_ITEM, lastName: "Withdrawer" }));
  main
    .library({ type: "group", id: GROUP_ITEM.groupID })
    .putItem(article({ ...GROUP_ITEM, lastName: "Groupwright" }));
  const second = new FakeZoteroApi(SECOND_ACCOUNT);
  second.user.putItem(
    article({ ...SECOND_ITEM, date: "2025", lastName: "Second" }),
  );
  const keys = {
    main: inventedKey(),
    second: inventedKey(),
    secondNoAccess: inventedKey(),
    unknown: inventedKey(),
  };
  main.addKey(keys.main, READ_ALL);
  second.addKey(keys.second, READ_ALL);
  second.addKey(keys.secondNoAccess, {});
  const apis = [main, second];
  const pick = (incoming: IncomingMessage) => {
    const presented =
      incoming.headers["zotero-api-key"] ??
      incoming.headers.authorization?.replace(/^Bearer /, "");
    return (
      apis.find(
        (api) => typeof presented === "string" && api.keys.has(presented),
      ) ?? main
    );
  };
  let origin = "";
  const relay = async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const response = await pick(incoming).handle(
      new Request(new URL(incoming.url ?? "/", origin), {
        method: incoming.method ?? "GET",
        headers,
      }),
    );
    const body = Buffer.from(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(body);
  };
  const server = createServer((incoming, outgoing) => {
    relay(incoming, outgoing).catch((error: unknown) => {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
      outgoing.end(Error.isError(error) ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const api of apis) api.baseUrl = origin;
  return {
    url: origin,
    main,
    second,
    keys,
    article,
    requests: () =>
      [...main.requests, ...second.requests].filter(
        ({ method }) => method !== "OPTIONS",
      ),
    [Symbol.asyncDispose]: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function messagePattern<P extends Record<string, string>>(
  message: (params: P) => string,
  params: P,
): RegExp {
  const marker = "\u0000";
  const text = message(
    Object.fromEntries(Object.keys(params).map((name) => [name, marker])) as P,
  );
  return new RegExp(
    `^${text
      .split(marker)
      .map((part) => RegExp.escape(part))
      .join(".+?")}$`,
  );
}

export const WEB_API_URL_KEY = "zotlit-zotero-web-api-url";

export async function setWebApiUrl(
  vaultId: string,
  url: string | null,
): Promise<void> {
  await obRun(
    vaultId,
    ({ app }, { key, url }) => {
      app.saveLocalStorage(key, url);
    },
    { key: WEB_API_URL_KEY, url },
  );
}

export interface LibrarySourceRows {
  rows: string[];
  status: string | null;
  accepted: string | null;
  source: string | null;
}

export async function librarySourceRows(
  vaultId: string,
  names: { group: string; source: string; status: string },
  {
    ready = () => true,
    what = "the rows of the Library source group",
    tries,
  }: {
    ready?: (rows: LibrarySourceRows) => boolean;
    what?: string;
    tries?: number;
  } = {},
): Promise<LibrarySourceRows> {
  return await obRunUntil(
    vaultId,
    ({ app }, { group, source, status }) => {
      const container = app.setting.containerEl;
      const heading = [
        ...container.querySelectorAll<HTMLElement>(".setting-item-heading"),
      ].find(
        (row) => row.querySelector(".setting-item-name")?.textContent === group,
      );
      const groupEl =
        heading?.closest<HTMLElement>(".setting-group") ??
        heading?.parentElement;
      const rows = [
        ...(groupEl?.querySelectorAll<HTMLElement>(
          ".setting-item:not(.setting-item-heading)",
        ) ?? []),
      ].filter((row) => row.checkVisibility());
      const named = (name: string) =>
        rows.find(
          (row) =>
            row.querySelector(".setting-item-name")?.textContent === name,
        );
      const spans = [
        ...(named(status)?.querySelectorAll<HTMLElement>(
          ".setting-item-description > span",
        ) ?? []),
      ];
      return {
        rows: rows.map(
          (row) => row.querySelector(".setting-item-name")?.textContent ?? "",
        ),
        status: spans[0]?.textContent ?? null,
        accepted:
          spans[1] && spans[1].checkVisibility() ? spans[1].textContent : null,
        source:
          named(source)?.querySelector<HTMLSelectElement>("select")?.value ??
          null,
      };
    },
    names,
    { ready, what, ...(tries === undefined ? {} : { tries }) },
  );
}

export async function onlineStatusShows(
  vaultId: string,
  {
    name,
    pattern,
    what,
    tries = 120,
  }: { name: string; pattern: RegExp; what: string; tries?: number },
): Promise<string> {
  const text = await obRunUntil(
    vaultId,
    ({ page }, { name }) =>
      page
        .settingRow(name)
        ?.querySelector<HTMLElement>(".setting-item-description > span")
        ?.textContent ?? null,
    { name },
    {
      ready: (value) => value !== null && pattern.test(value),
      what,
      tries,
    },
  );
  return text!;
}

export async function pickRowOption(
  vaultId: string,
  { name, value }: { name: string; value: string },
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { name, value }) => {
      const row = [
        ...app.setting.containerEl.querySelectorAll<HTMLElement>(
          ".setting-item:not(.setting-item-heading)",
        ),
      ].find(
        (el) => el.querySelector(".setting-item-name")?.textContent === name,
      );
      await page.pick(
        row?.querySelector<HTMLSelectElement>("select"),
        value,
        `the dropdown of ${name}`,
      );
    },
    { name, value },
  );
}

export async function linkSecret(
  vaultId: string,
  { row, name, value }: { row: string; name: string; value: string },
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { row, name, value }) => {
      const { press, until } = page;
      const modal = () =>
        [
          ...document.querySelectorAll<HTMLElement>(".modal-container .modal"),
        ].at(-1) ?? null;
      const type = (
        input: HTMLInputElement | null | undefined,
        text: string,
      ) => {
        if (!input) throw new Error("Missing: an input of the secret dialog");
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const createSecret = async () => {
        const form = await until("the dialog that adds a secret", () =>
          modal()?.querySelector<HTMLFormElement>("form#secret-form"),
        );
        const inputs = form.querySelectorAll<HTMLInputElement>("input");
        type(inputs[0], name);
        type(inputs[1], value);
        const save = [
          ...document.querySelectorAll<HTMLButtonElement>(
            'button[form="secret-form"]',
          ),
        ].find((button) => button.checkVisibility());
        if (save) press(save, "Save of the dialog that adds a secret");
        else form.requestSubmit();
        await until(
          "the dialog that adds a secret to close",
          () => !form.isConnected,
        );
      };
      const known = app.secretStorage.getSecret(name) !== null;
      const empty = app.secretStorage.listSecrets().length === 0;
      press(
        page
          .settingRow(row)
          ?.querySelector<HTMLButtonElement>(".setting-item-control button"),
        `the secret control of ${row}`,
      );
      if (empty) {
        await createSecret();
        return;
      }
      const chooser = await until("the dialog that selects a secret", () =>
        modal()?.classList.contains("mod-secret") ? modal() : null,
      );
      if (!known) {
        press(
          [
            ...chooser.querySelectorAll<HTMLButtonElement>(
              ".modal-button-container button",
            ),
          ].find(
            (button) =>
              !button.classList.contains("mod-cta") &&
              !button.classList.contains("mod-cancel"),
          ),
          "Add secret of the dialog that selects a secret",
        );
        await createSecret();
      }
      const select = await until("the dialog that selects a secret", () =>
        modal()?.classList.contains("mod-secret") ? modal() : null,
      );
      const option = await until(`the secret ${name} in the list`, () =>
        [
          ...select.querySelectorAll<HTMLElement>(".suggestion-secret-key"),
        ].find(
          (el) => el.querySelector(".suggestion-title")?.textContent === name,
        ),
      );
      option.click();
      press(
        select.querySelector<HTMLButtonElement>(
          ".modal-button-container button.mod-cta",
        ),
        "Save of the dialog that selects a secret",
      );
      await until(
        "the dialog that selects a secret to close",
        () => !select.isConnected,
      );
    },
    { row, name, value },
  );
}

export interface ItemFound {
  key: string;
  title: string | null;
}

export async function searchItems(
  vaultId: string,
  query: string,
): Promise<ItemFound[]> {
  return await obRun(
    vaultId,
    async ({ zotlit }, { query }) =>
      (await zotlit.services.itemLookup.search(query, { limit: 20 })).map(
        (hit) => ({
          key: hit.item.key,
          title:
            ("title" in hit.item.fields ? hit.item.fields.title : null) ?? null,
        }),
      ),
    { query },
  );
}

export async function replicaPoolFiles(
  vaultId: string,
): Promise<string[] | null> {
  return await obRun(vaultId, async ({ app }) => {
    const walk = async (
      dir: FileSystemDirectoryHandle,
      prefix: string,
    ): Promise<string[]> => {
      const found: string[] = [];
      for await (const [name, handle] of dir.entries()) {
        found.push(`${prefix}${name}${handle.kind === "directory" ? "/" : ""}`);
        if (handle.kind === "directory")
          found.push(...(await walk(handle, `${prefix}${name}/`)));
      }
      return found;
    };
    try {
      const root = await navigator.storage.getDirectory();
      const pool = await (
        await root.getDirectoryHandle("zotlit")
      ).getDirectoryHandle(app.appId);
      return (await walk(pool, "")).sort();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return null;
      throw error;
    }
  });
}

export interface PoolPeak {
  size: number;
  files: string[];
}

export interface WebWorkerProbe {
  found: boolean;
  console: string[];
  vfs: string[] | null;
  pool: { capacity: number; files: string[]; peak: PoolPeak | null } | null;
}

export async function probeWebWorker(
  vaultId: string,
  workerName: string,
  { watchPool = false }: { watchPool?: boolean } = {},
): Promise<WebWorkerProbe> {
  return await obRun(
    vaultId,
    async ({ page }, { workerName, watchPool }) => {
      const remote =
        require("@electron/remote") as typeof import("@electron/remote");
      const client = remote.getCurrentWebContents().debugger;
      const attached = client.isAttached();
      if (!attached) client.attach("1.3");
      const sessions: string[] = [];
      const lines: { sessionId: string; text: string }[] = [];
      const listener = (
        ...[, method, params, sessionId]: [
          unknown,
          string,
          {
            sessionId?: string;
            targetInfo?: { type: string; title: string; url: string };
            type?: string;
            args?: { value?: unknown; description?: string }[];
          },
          string?,
        ]
      ) => {
        if (
          method === "Target.attachedToTarget" &&
          params.targetInfo?.type === "worker" &&
          (params.targetInfo.title === workerName ||
            params.targetInfo.url.includes(workerName))
        )
          sessions.push(params.sessionId!);
        if (method === "Runtime.consoleAPICalled" && sessionId)
          lines.push({
            sessionId,
            text: `${params.type}: ${(params.args ?? [])
              .map((arg) =>
                typeof arg.value === "string"
                  ? arg.value
                  : (arg.description ?? JSON.stringify(arg.value)),
              )
              .join(" ")}`,
          });
      };
      client.on("message", listener);
      try {
        await client.sendCommand("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: true,
        });
        const session = await page
          .until("the online library Worker to attach", () => sessions[0], 5000)
          .catch(() => null);
        if (!session)
          return { found: false, console: [], vfs: null, pool: null };
        await client.sendCommand("Runtime.enable", {}, session);
        await new Promise((resolve) => setTimeout(resolve, 500));
        const objects = async (prototype: string) => {
          const { result } = (await client.sendCommand(
            "Runtime.evaluate",
            { expression: prototype },
            session,
          )) as { result: { objectId: string } };
          const { objects } = (await client.sendCommand(
            "Runtime.queryObjects",
            { prototypeObjectId: result.objectId },
            session,
          )) as { objects: { objectId: string } };
          return objects.objectId;
        };
        const instances = await objects("WebAssembly.Instance.prototype");
        const memories = await objects("WebAssembly.Memory.prototype");
        const walk = function (
          this: WebAssembly.Instance[],
          memories: WebAssembly.Memory[],
        ) {
          const sqlite = this.find(
            (instance) =>
              typeof instance.exports.sqlite3_vfs_find === "function",
          );
          if (!sqlite) return null;
          const head = (
            sqlite.exports.sqlite3_vfs_find as (name: number) => number
          )(0);
          for (const memory of memories) {
            const view = new DataView(memory.buffer);
            const text = (start: number) => {
              let out = "";
              for (let at = start, byte; (byte = view.getUint8(at)) !== 0; at++)
                out += String.fromCharCode(byte);
              return out;
            };
            try {
              const names: string[] = [];
              for (
                let vfs = head;
                vfs !== 0 && names.length < 32;
                vfs = view.getUint32(vfs + 12, true)
              )
                names.push(text(view.getUint32(vfs + 16, true)));
              if (names.length > 0 && names.every((n) => /^[\w-]+$/.test(n)))
                return names;
            } catch {
              continue;
            }
          }
          return null;
        };
        const { result } = (await client.sendCommand(
          "Runtime.callFunctionOn",
          {
            objectId: instances,
            functionDeclaration: walk.toString(),
            arguments: [{ objectId: memories }],
            returnByValue: true,
          },
          session,
        )) as { result: { value: string[] | null } };
        const maps = await objects("Map.prototype");
        const slots = function (this: Map<unknown, unknown>[], watch: boolean) {
          const { FileSystemSyncAccessHandle: SyncHandle } =
            globalThis as unknown as {
              FileSystemSyncAccessHandle: abstract new () => object;
            };
          const handle = (value: unknown) => value instanceof SyncHandle;
          const byHandle = this.find(
            (map) => map.size > 0 && [...map.keys()].every(handle),
          );
          const byName = this.find(
            (map) =>
              map.size > 0 &&
              [...map.keys()].every((key) => typeof key === "string") &&
              [...map.values()].every(handle),
          );
          if (!byHandle) return null;
          const scope = globalThis as { zotlitE2EPoolPeak?: PoolPeak };
          const named = (map: Map<unknown, unknown>) => ({
            size: map.size,
            files: [...map.keys()].map(String).sort(),
          });
          if (watch && byName) {
            scope.zotlitE2EPoolPeak = named(byName);
            byName.set = function (
              this: Map<unknown, unknown>,
              key: unknown,
              value: unknown,
            ) {
              const result = Map.prototype.set.call(this, key, value);
              if (this.size > (scope.zotlitE2EPoolPeak?.size ?? 0))
                scope.zotlitE2EPoolPeak = named(this);
              return result;
            };
          }
          return {
            capacity: byHandle.size,
            files: [...(byName?.keys() ?? [])].map(String).sort(),
            peak: scope.zotlitE2EPoolPeak ?? null,
          };
        };
        const pool = (await client.sendCommand(
          "Runtime.callFunctionOn",
          {
            objectId: maps,
            functionDeclaration: slots.toString(),
            arguments: [{ value: watchPool }],
            returnByValue: true,
          },
          session,
        )) as {
          result: { value: WebWorkerProbe["pool"] };
        };
        return {
          found: true,
          console: lines
            .filter((line) => line.sessionId === session)
            .map((line) => line.text),
          vfs: result.value,
          pool: pool.result.value,
        };
      } finally {
        await client
          .sendCommand("Target.setAutoAttach", {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          })
          .catch(() => undefined);
        client.removeListener("message", listener);
        if (!attached) client.detach();
      }
    },
    { workerName, watchPool },
    { timeoutMs: 30_000 },
  );
}

export async function replicaPoolNames(
  vaultId: string,
): Promise<string[] | null> {
  return await obRun(vaultId, async ({ app }) => {
    const names: string[] = [];
    const walk = async (dir: FileSystemDirectoryHandle) => {
      for await (const handle of dir.values()) {
        if (handle.kind === "directory") {
          await walk(handle);
          continue;
        }
        const head = new Uint8Array(
          await (await handle.getFile()).slice(0, 512).arrayBuffer(),
        );
        const end = head.indexOf(0);
        const name = new TextDecoder().decode(
          head.subarray(0, end < 0 ? head.length : end),
        );
        if (name) names.push(name);
      }
    };
    try {
      const root = await navigator.storage.getDirectory();
      await walk(
        await (
          await root.getDirectoryHandle("zotlit")
        ).getDirectoryHandle(app.appId),
      );
      return names.sort();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return null;
      throw error;
    }
  });
}

declare module "./page-helpers.ts" {
  interface PageScratch {
    onlineLibraryTimer?: typeof setTimeout;
    onlineLibraryOtherWindow?: number;
    onlineLibraryReads?: { seen: string[]; stop: () => void };
  }
}

export async function focusMainWindow(
  vaultId: string,
  focused: boolean,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ page }, { focused }) => {
      const remote =
        require("@electron/remote") as typeof import("@electron/remote");
      const { execFileSync } =
        require("node:child_process") as typeof import("node:child_process");
      const xid = (win: import("electron").BrowserWindow) =>
        `0x${win.getNativeWindowHandle().readUInt32LE(0).toString(16)}`;
      let target = remote.getCurrentWindow();
      if (!focused) {
        const known =
          page.scratch.onlineLibraryOtherWindow === undefined
            ? null
            : remote.BrowserWindow.fromId(
                page.scratch.onlineLibraryOtherWindow,
              );
        if (known) target = known;
        else {
          target = new remote.BrowserWindow({ width: 320, height: 200 });
          await target.loadURL("about:blank");
          page.scratch.onlineLibraryOtherWindow = target.id;
        }
      }
      execFileSync("herbstclient", ["jumpto", xid(target)]);
      await page.until(
        focused
          ? "the vault window to get focus"
          : "the vault window to lose focus",
        () => document.hasFocus() === focused,
        5000,
      );
    },
    { focused },
  );
}

export async function recordReads(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page, zotlit }) => {
    const s = zotlit.services;
    page.scratch.onlineLibraryReads?.stop();
    const seen: string[] = [];
    const stops = [
      s.bridge.subscribe(s.zoteroReads.changes, ({ state }) => {
        seen.push(`state:${state}`);
      }),
      s.bridge.subscribe(s.zoteroReads.events, ({ _tag }) => {
        seen.push(_tag);
      }),
    ];
    page.scratch.onlineLibraryReads = {
      seen,
      stop: () => {
        for (const stop of stops) stop();
      },
    };
  });
}

export async function recordedReads(
  vaultId: string,
  { stop }: { stop: boolean },
): Promise<string[]> {
  return await obRun(
    vaultId,
    ({ page }, { stop }) => {
      const record = page.scratch.onlineLibraryReads;
      if (!record) throw new Error("Missing: a record of the reads");
      if (stop) {
        record.stop();
        delete page.scratch.onlineLibraryReads;
      }
      return [...record.seen];
    },
    { stop },
  );
}

export async function closeOtherWindow(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    const remote =
      require("@electron/remote") as typeof import("@electron/remote");
    const id = page.scratch.onlineLibraryOtherWindow;
    delete page.scratch.onlineLibraryOtherWindow;
    if (id !== undefined) remote.BrowserWindow.fromId(id)?.destroy();
  });
}

export const SYNC_INTERVAL_MS = 5 * 60_000;

export async function shortenSyncInterval(
  vaultId: string,
  shortMs: number | null,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { shortMs, interval }) => {
      const native = page.scratch.onlineLibraryTimer ?? window.setTimeout;
      if (shortMs === null) {
        window.setTimeout = native;
        delete page.scratch.onlineLibraryTimer;
        return;
      }
      page.scratch.onlineLibraryTimer = native;
      window.setTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...rest: unknown[]
      ) =>
        native(
          handler,
          timeout === interval ? shortMs : timeout,
          ...rest,
        )) as typeof setTimeout;
      await app.plugins.enablePlugin("zotlit");
    },
    { shortMs, interval: SYNC_INTERVAL_MS },
    { timeoutMs: 120_000 },
  );
}

export type PackVariant = "older" | "newer" | "malformed";

export async function installPackVariant(
  vaultId: string,
  variant: PackVariant,
): Promise<void> {
  await obRun(
    vaultId,
    async ({ app, page }, { variant }) => {
      const dir = page.scratch.zotlitE2EPackManifest!.dir!;
      const file = new Uint8Array(page.scratch.zotlitE2EPackFile!.slice(0));
      const head = new TextDecoder().decode(file.subarray(0, 8192));
      const entry = /\{[^{}]*"sqlite-engine"[^{}]*\}/.exec(head)![0];
      const version = /"upstreamVersion":"([^"]+)"/.exec(entry)![1]!;
      const parts = /^(\d+)\.(\d+)\.(\d+)-build(\d+)$/.exec(version)!;
      const patch = Number(parts[3]);
      const changed =
        variant === "malformed"
          ? version.replace(/build(\d)/, "buildX")
          : `${parts[1]}.${parts[2]}.${variant === "older" ? patch - 1 : patch + 1}-build${parts[4]}`;
      if (changed.length !== version.length)
        throw new Error(`cannot change ${version} in place`);
      const at = head.indexOf(`"${version}"`) + 1;
      file.set(new TextEncoder().encode(changed), at);
      await app.vault.adapter.writeBinary(`${dir}/main.js`, file.buffer);
      await app.plugins.loadManifest(dir);
      app.plugins.didChange();
    },
    { variant },
    { timeoutMs: 60_000 },
  );
}

export async function replicaPoolHolds(
  vaultId: string,
  text: string,
): Promise<boolean> {
  return await obRun(
    vaultId,
    async ({ app }, { text }) => {
      const needle = new TextEncoder().encode(text);
      const holds = (bytes: Uint8Array) => {
        for (
          let at = bytes.indexOf(needle[0]!);
          at >= 0;
          at = bytes.indexOf(needle[0]!, at + 1)
        )
          if (needle.every((byte, i) => bytes[at + i] === byte)) return true;
        return false;
      };
      const walk = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
        for await (const handle of dir.values()) {
          if (handle.kind === "directory") {
            if (await walk(handle)) return true;
          } else if (
            holds(new Uint8Array(await (await handle.getFile()).arrayBuffer()))
          )
            return true;
        }
        return false;
      };
      try {
        const root = await navigator.storage.getDirectory();
        return await walk(
          await (
            await root.getDirectoryHandle("zotlit")
          ).getDirectoryHandle(app.appId),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError")
          return false;
        throw error;
      }
    },
    { text },
    { timeoutMs: 60_000 },
  );
}

export async function replicaFileBytes(
  vaultId: string,
  name: string,
): Promise<Buffer | null> {
  const encoded = await obRun(
    vaultId,
    async ({ app }, { name }) => {
      const slots: FileSystemFileHandle[] = [];
      const walk = async (dir: FileSystemDirectoryHandle) => {
        for await (const handle of dir.values())
          if (handle.kind === "directory") await walk(handle);
          else slots.push(handle);
      };
      try {
        await walk(
          await (
            await (
              await navigator.storage.getDirectory()
            ).getDirectoryHandle("zotlit")
          ).getDirectoryHandle(app.appId),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotFoundError")
          return null;
        throw error;
      }
      for (const slot of slots) {
        const bytes = new Uint8Array(
          await (await slot.getFile()).arrayBuffer(),
        );
        const end = bytes.indexOf(0);
        if (new TextDecoder().decode(bytes.subarray(0, end)) !== name) continue;
        let text = "";
        for (const byte of bytes.subarray(4096))
          text += String.fromCharCode(byte);
        return btoa(text);
      }
      return null;
    },
    { name },
    { timeoutMs: 60_000 },
  );
  return encoded === null ? null : Buffer.from(encoded, "base64");
}

export function replicaRowCounts(bytes: Buffer): Record<string, unknown> {
  const path = join(mkdtempSync(join(tmpdir(), "zotlit-replica-")), "r.sqlite");
  writeFileSync(path, bytes);
  const sqlite = new DatabaseSync(path, { readOnly: true });
  try {
    const count = (sql: string) =>
      (sqlite.prepare(sql).get() as { n: number }).n;
    return {
      libraries: count("select count(*) as n from libraries"),
      items: count("select count(*) as n from items"),
      account: count(
        "select count(*) as n from settings where setting = 'account'",
      ),
      libraryRows: sqlite
        .prepare("select libraryID, type, version, lastSync from libraries")
        .all(),
      accountRows: sqlite
        .prepare("select key, value from settings where setting = 'account'")
        .all(),
    };
  } finally {
    sqlite.close();
    rmSync(dirname(path), { recursive: true, force: true });
  }
}
