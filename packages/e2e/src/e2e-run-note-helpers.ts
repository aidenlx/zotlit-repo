import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";

import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import { LIBRARIES } from "@zotlit/scripts/fixture";
import type { LibrarySelector } from "@zotlit/scripts/fixture";

import type { CreateOperationReply } from "./e2e-run-note-types.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type { FrameRecord } from "./page-notes-types.ts";

async function createFixtureNote(
  vaultId: string,
  itemID: number,
  profile?: import("@zotlit/obsidian-kit/profile-stamp.ts").ProfileSelector,
): Promise<CreateOperationReply> {
  return obRun(
    vaultId,
    async ({ zotlit }, { itemID, profile }) => {
      const hits = await zotlit.services.itemLookup.search("", { limit: 100 });
      const hit = hits.find((candidate) => candidate.item.itemID === itemID);
      if (!hit) throw new Error("Fixture Item not found");
      const result = await zotlit.services.noteFeature.createNote(hit.item, {
        profile,
      });
      return result.outcome === "created"
        ? {
            outcome: "created" as const,
            path: result.file.path,
            indexedKey: hit.item.indexedKey,
          }
        : { outcome: "refused" as const, diagnostic: result.diagnostic };
    },
    { itemID, profile },
  );
}

async function recordFrames(vaultId: string): Promise<
  AsyncDisposable & {
    read(): Promise<{
      frames: number;
      maxFrameGapMs: number;
      longTasks: number;
      longestTaskMs: number;
    }>;
  }
> {
  await obRun(
    vaultId,
    async ({ page }) => {
      const record: FrameRecord = {
        frames: 0,
        maxFrameGapMs: 0,
        longTasks: 0,
        longestTaskMs: 0,
        live: true,
        observer: null,
      };
      let previous = performance.now();
      const tick = function (now: number) {
        record.frames++;
        record.maxFrameGapMs = Math.max(record.maxFrameGapMs, now - previous);
        previous = now;
        if (record.live) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      record.observer = new PerformanceObserver(function (list) {
        for (let entry of list.getEntries()) {
          record.longTasks++;
          record.longestTaskMs = Math.max(record.longestTaskMs, entry.duration);
        }
      });
      record.observer.observe({ type: "longtask" });
      page.scratch.frames = record;
    },
    undefined,
  );
  return {
    async read() {
      return await obRun(
        vaultId,
        async ({ page }) => {
          const r = page.scratch.frames!;
          return {
            frames: r.frames,
            maxFrameGapMs: Math.round(r.maxFrameGapMs),
            longTasks: r.longTasks,
            longestTaskMs: Math.round(r.longestTaskMs),
          };
        },
        undefined,
      );
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          const r = page.scratch.frames!;
          r.live = false;
          r.observer!.disconnect();
          delete page.scratch.frames;
        },
        undefined,
      );
    },
  };
}

async function waitForOneIndexedNote(
  vaultId: string,
  indexedKey: string,
): Promise<void> {
  await waitForIndexedNotes(vaultId, indexedKey, 1);
}

async function waitForIndexedNotes(
  vaultId: string,
  indexedKey: string,
  count: number,
): Promise<void> {
  await obRunUntil(
    vaultId,
    async ({ zotlit }, { indexedKey }) => {
      return zotlit.services.bridge.runSync(
        zotlit.services.noteIndex.getNotesByItemKey(indexedKey),
      ).length;
    },
    { indexedKey },
    {
      ready: (value) => value === count,
      what: "notes indexed under the item key to match the expected count",
    },
  );
}

async function indexedNote(
  vaultId: string,
  itemID: number,
): Promise<{ indexedKey: string; path: string | null }> {
  return obRun(
    vaultId,
    async ({ zotlit }, { itemID }) => {
      const hits = await zotlit.services.itemLookup.search("", { limit: 100 });
      const hit = hits.find((candidate) => candidate.item.itemID === itemID);
      if (!hit) throw new Error("Fixture Item not found");
      const notes = zotlit.services.bridge.runSync(
        zotlit.services.noteIndex.getNotesByItemKey(hit.item.indexedKey),
      );
      return { indexedKey: hit.item.indexedKey, path: notes[0]?.path ?? null };
    },
    { itemID },
  );
}

function expectedLibraryIDs(selectors: readonly LibrarySelector[]): number[] {
  return selectors
    .map((selector) => {
      const library =
        selector.type === "personal"
          ? LIBRARIES.find((candidate) => candidate.groupID === null)
          : LIBRARIES.find(
              (candidate) => candidate.groupID === selector.groupID,
            );
      if (!library) {
        throw new Error(
          `no Fixture Library for selector ${JSON.stringify(selector)}`,
        );
      }
      return library.libraryID;
    })
    .toSorted((a, b) => a - b);
}

function managedRegion(source: string): string {
  const start = source.indexOf("%%zt-managed%%");
  const end = source.indexOf("%%/zt-managed%%", start);
  if (start < 0 || end < 0) throw new Error("Missing Managed Region");
  return source.slice(start, end + "%%/zt-managed%%".length);
}

function noteBody(source: string): string {
  const end = source.indexOf("\n---", 3);
  if (!source.startsWith("---\n") || end < 0)
    throw new Error("Missing frontmatter");
  return source.slice(end + 4);
}

async function hoverSuggestion(
  vaultId: string,
  match: { text: string } | { key: string },
): Promise<string> {
  return obRunUntil<{ text: string } | { key: string }, string | null>(
    vaultId,
    (_context, match: { text: string } | { key: string }) => {
      const prompt = Array.from(activeDocument.querySelectorAll(".prompt")).at(
        -1,
      );
      const row = Array.from(
        prompt?.querySelectorAll<HTMLElement>(".suggestion-item") ?? [],
      ).find((row) =>
        "text" in match
          ? row.textContent.includes(match.text)
          : !row.closest("[aria-busy]") && row.dataset.indexedKey === match.key,
      );
      if (!row) return null;
      row.dispatchEvent(
        new (activeWindow as Window & typeof globalThis).MouseEvent(
          "mousemove",
          { bubbles: true },
        ),
      );
      return row.classList.contains("is-selected") ? row.textContent : null;
    },
    match,
    { what: "selected prompt row", ready: (value) => value !== null },
  ).then((value) => value!);
}

function selectSuggestion(vaultId: string, needle: string): Promise<string> {
  return hoverSuggestion(vaultId, { text: needle });
}

async function selectItemSuggestion(
  vaultId: string,
  query: string,
  key: string,
): Promise<string> {
  await obRun(
    vaultId,
    async (_context, { query }) => {
      const input = Array.from(activeDocument.querySelectorAll(".prompt"))
        .at(-1)!
        .querySelector("input")!;
      input.value = query;
      input.dispatchEvent(
        new input.ownerDocument.defaultView!.Event("input", { bubbles: true }),
      );
    },
    { query },
  );
  return hoverSuggestion(vaultId, { key });
}

async function pressPromptKey(
  vaultId: string,
  key: "Enter" | "Escape",
  modifiers: { altKey?: boolean } = {},
): Promise<void> {
  const keyCode = key === "Enter" ? 13 : 27;
  await obRun(
    vaultId,
    async (_context, { keyEventInit }) => {
      Array.from(activeDocument.querySelectorAll(".prompt"))
        .at(-1)!
        .querySelector("input")!
        .dispatchEvent(
          new (activeWindow as Window & typeof globalThis).KeyboardEvent(
            "keydown",
            keyEventInit,
          ),
        );
    },
    {
      keyEventInit: {
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        ...modifiers,
      },
    },
  );
}

function clickModalButton(
  vaultId: string,
  label: string,
  documentTarget: "activeDocument" | "document" | "settings" = "activeDocument",
): Promise<boolean> {
  return obRunUntil(
    vaultId,
    ({ app, page }, { label, documentTarget }) => {
      const doc =
        documentTarget === "document"
          ? document
          : documentTarget === "settings"
            ? app.setting.containerEl.ownerDocument
            : activeDocument;
      const modal = Array.from(doc.querySelectorAll(".modal")).at(-1);
      const button = Array.from(modal?.querySelectorAll("button") ?? []).find(
        (button) => button.textContent.trim() === label,
      );
      if (!button || button.disabled) return false;
      page.press(button, label);
      return true;
    },
    { label, documentTarget },
    { what: `modal button ${label}` },
  );
}

async function observeNotices(vaultId: string) {
  await obRun(
    vaultId,
    async ({ page }) => {
      using observers = new DisposableStack();
      const values = new Map<Element, string>();
      const documents = new Set([...page.windowDocuments(), activeDocument]);
      for (const doc of documents) {
        const previous = new Set(doc.querySelectorAll(".notice"));
        const observer = observers.adopt(
          new doc.defaultView!.MutationObserver(() => {
            for (const element of doc.querySelectorAll(".notice"))
              if (!previous.has(element))
                values.set(element, element.textContent);
          }),
          (value) => value.disconnect(),
        );
        observer.observe(doc.body, { childList: true, subtree: true });
      }
      page.scratch.notices = { observers: observers.move(), values };
    },
    undefined,
  );
  return {
    async read(): Promise<string[]> {
      return await obRun(
        vaultId,
        async ({ page }) => {
          return [...page.scratch.notices!.values.values()];
        },
        undefined,
      );
    },
    async [Symbol.asyncDispose]() {
      await obRun(
        vaultId,
        async ({ page }) => {
          page.scratch.notices!.observers[Symbol.dispose]();
          delete page.scratch.notices;
        },
        undefined,
      );
    },
  };
}

const SYNTHETIC_CORPUS_SIZE = 10_000;
const SYNTHETIC_MARKER = "zqsynth";

function syntheticTitles(count: number): string[] {
  let seed = 42;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const syllables = "ka ri mo ne lu ta si po ve ga ro mi da ze nu fo".split(
    " ",
  );
  const vocabulary = Array.from({ length: 600 }, () =>
    Array.from(
      { length: 2 + (random() % 3) },
      () => syllables[random() % syllables.length],
    ).join(""),
  );
  return Array.from({ length: count }, (_, index) =>
    [
      SYNTHETIC_MARKER,
      ...Array.from(
        { length: 6 + (random() % 8) },
        () => vocabulary[random() % vocabulary.length],
      ),
      `v${index}`,
    ].join(" "),
  );
}

function addMyLibraryItems(
  databasePath: string,
  titles: readonly string[],
): Disposable & { firstItemID: number } {
  using database = new DatabaseSync(databasePath);
  const id = (sql: string, ...params: string[]) =>
    Number(Object.values(database.prepare(sql).get(...params)!)[0]);
  const itemTypeID = id(
    "select itemTypeID from itemTypes where typeName = 'journalArticle'",
  );
  const field = (name: string) =>
    id("select fieldID from fieldsCombined where fieldName = ?", name);
  const titleField = field("title");
  const journalField = field("publicationTitle");
  const authorTypeID = id(
    "select creatorTypeID from creatorTypes where creatorType = 'author'",
  );
  const firstItemID = id("select max(itemID) + 1 from items");
  const firstValueID = id("select max(valueID) + 1 from itemDataValues");
  const firstCreatorID = id(
    "select coalesce(max(creatorID), 0) + 1 from creators",
  );
  const libraryID = LIBRARIES.find(
    ({ groupID }) => groupID === null,
  )!.libraryID;

  database.exec("begin");
  using rollback = new DisposableStack();
  rollback.defer(() => database.exec("rollback"));
  const value = database.prepare(
    "insert into itemDataValues (valueID, value) values (?, ?)",
  );
  const journals = Array.from({ length: 40 }, (_, index) => {
    value.run(
      firstValueID + index,
      `${SYNTHETIC_MARKER} journal ${firstItemID + index}`,
    );
    return firstValueID + index;
  });
  const creator = database.prepare(
    "insert into creators (creatorID, firstName, lastName, fieldMode) values (?, ?, ?, 0)",
  );
  const creators = Array.from({ length: 400 }, (_, index) => {
    creator.run(
      firstCreatorID + index,
      "A.",
      `Synthauthor${firstItemID + index}`,
    );
    return firstCreatorID + index;
  });
  const item = database.prepare(
    "insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified, clientDateModified) values (?, ?, ?, ?, '2030-01-01 00:00:00', '2030-01-01 00:00:00', '2030-01-01 00:00:00')",
  );
  const data = database.prepare(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
  );
  const author = database.prepare(
    "insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex) values (?, ?, ?, ?)",
  );
  const titleValueID = firstValueID + journals.length;
  titles.forEach((title, index) => {
    const itemID = firstItemID + index;
    item.run(itemID, itemTypeID, libraryID, zoteroKey(itemID));
    value.run(titleValueID + index, title);
    data.run(itemID, titleField, titleValueID + index);
    data.run(itemID, journalField, journals[index % journals.length]!);
    for (let order = 0; order <= index % 3; order++) {
      author.run(
        itemID,
        creators[(index * 7 + order) % creators.length]!,
        authorTypeID,
        order,
      );
    }
  });
  database.exec("commit");
  rollback.move();

  const lastItemID = firstItemID + titles.length - 1;
  return {
    firstItemID,
    [Symbol.dispose]() {
      using database = new DatabaseSync(databasePath);
      database.exec("begin");
      for (const table of ["itemCreators", "itemData", "items"])
        database
          .prepare(`delete from ${table} where itemID between ? and ?`)
          .run(firstItemID, lastItemID);
      database
        .prepare("delete from itemDataValues where valueID between ? and ?")
        .run(firstValueID, titleValueID + titles.length - 1);
      database
        .prepare("delete from creators where creatorID between ? and ?")
        .run(firstCreatorID, firstCreatorID + creators.length - 1);
      database.exec("commit");
    },
  };
}

function zoteroKey(itemID: number): string {
  const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  let key = "";
  for (let rest = itemID, place = 0; place < 6; place++) {
    key = alphabet[rest % alphabet.length] + key;
    rest = Math.floor(rest / alphabet.length);
  }
  return `ZQ${key}`;
}

async function signalDatabaseUpdated(vaultId: string): Promise<void> {
  const server = (await obRun(
    vaultId,
    async ({ zotlit }) => {
      const services = zotlit.services;
      const settings = services.bridge.runSync(services.settings.current);
      return {
        hostname: settings["server.hostname"],
        port: services.bridge.runSync(services.localServer.effectivePort),
        sourceId: services.bridge.runSync(services.zoteroPref.current).sourceId,
      };
    },
    undefined,
  )) as { hostname: string; port: number; sourceId: string };
  const response = await fetch(
    `http://${server.hostname}:${server.port}/notify`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: server.sourceId,
      },
      body: JSON.stringify({ event: "db/updated" }),
    },
  );
  expect(response.status).toBe(204);
}

async function rendererHeap(vaultId: string): Promise<number> {
  return await obRun(
    vaultId,
    async (_context) => {
      require("v8").setFlagsFromString("--expose-gc");
      const gc = (require("vm") as typeof import("node:vm")).runInNewContext(
        "gc",
      ) as () => void;
      gc();
      gc();
      return process.memoryUsage().heapUsed;
    },
    undefined,
  );
}

export {
  SYNTHETIC_CORPUS_SIZE,
  SYNTHETIC_MARKER,
  createFixtureNote,
  recordFrames,
  waitForOneIndexedNote,
  waitForIndexedNotes,
  indexedNote,
  expectedLibraryIDs,
  managedRegion,
  noteBody,
  pressPromptKey,
  selectSuggestion,
  selectItemSuggestion,
  clickModalButton,
  observeNotices,
  syntheticTitles,
  addMyLibraryItems,
  zoteroKey,
  signalDatabaseUpdated,
  rendererHeap,
};
