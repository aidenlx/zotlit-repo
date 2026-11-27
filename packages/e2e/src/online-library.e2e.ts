import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { WorkspaceLeaf } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LibraryView } from "@zotlit/library-view/desktop/library/view.ts";
import { RESOURCE_PACK_ID } from "@zotlit/plugin-services/core/managed-binary/resource-pack.ts";
import { pluginsOption } from "@zotlit/scripts/vault-plugins";

import { prepareRunWindow } from "./background-throttling.ts";
import {
  annotationItem,
  annotationKeys,
  e2eFixture,
  reachable,
  runVaultScript,
  targetItem,
  workspaceRoot,
} from "./e2e-run-fixture.ts";
import { openProfilesSettings } from "./e2e-run-helpers.ts";
import { clickModalButton } from "./e2e-run-note-helpers.ts";
import type { ItemQueryReport } from "./e2e-run-query-types.ts";
import { revealQueryView, readQueryViewUntil } from "./note-query-view.ts";
import {
  clearNotices,
  cliCommand,
  obRun,
  obRunUntil,
  readUntil,
} from "./obsidian-cli.ts";
import {
  closeOtherWindow,
  DATED_ITEM,
  DOOMED_ITEM,
  focusMainWindow,
  GROUP_ITEM,
  GROUPS_ONLY,
  installPackVariant,
  librarySourceRows,
  linkSecret,
  messagePattern,
  ONLINE_ITEM,
  onlineStatusShows,
  pickRowOption,
  probeWebWorker,
  READ_ALL,
  recordedReads,
  recordReads,
  replicaPoolFiles,
  replicaFileBytes,
  replicaPoolHolds,
  replicaPoolNames,
  replicaRowCounts,
  searchItems,
  SECOND_ACCOUNT,
  SECOND_ITEM,
  setWebApiUrl,
  shortenSyncInterval,
  startOnlineLibraryApi,
  WEB_API_URL_KEY,
} from "./online-library.ts";
import type { LibrarySourceRows, OnlineLibraryApi } from "./online-library.ts";
import {
  keepRunPack,
  pressSettingRowAction,
  restartZotlit,
  restoreRunPack,
} from "./resource-pack.ts";
import { registerRunVaultGuard } from "./run-vault-guard.ts";
import {
  clearVault,
  e2eVaultDir,
  installPlugins,
  installWithoutEnabling,
} from "./vault-script.ts";
import { reloadWindow } from "./window-reload.ts";
import { turnZotlitOff } from "./zotlit-restart.ts";

const m = await import("@zotlit/plugin-messages/messages.ts");

const MAIN_SECRET = "zotero-online-library";
const SECOND_SECRET = "zotero-second-account";
const WEB_WORKER_NAME = "zotlit-zotero-reads-web";
const REPLICA_FILE = "/zotero-replica.sqlite";
const SHORT_SYNC_INTERVAL_MS = 2_000;
const SETTLE_MS = SHORT_SYNC_INTERVAL_MS * 2;
const FIVE_PASSES_MS = SHORT_SYNC_INTERVAL_MS * 5;
const QUERY_NOTE = "Online query.md";
const ADDED_KEY = "ADDEDZL2";
const commandTitle = `${targetItem.title}, synced by the command`;
const focusedTitle = `${targetItem.title}, synced on the schedule`;
const awayTitle = `${targetItem.title}, synced when focus returns`;

let edits = 0;
function edit(
  api: OnlineLibraryApi["main"],
  key: string,
  change: Record<string, unknown>,
): void {
  edits += 1;
  api.user.updateItem(key, {
    ...change,
    dateModified: Temporal.Instant.from("2026-02-01T00:00:00Z")
      .add({ seconds: edits })
      .toString(),
  });
}

const names = {
  group: m.settings_library_source_heading(),
  source: m.settings_library_source_name(),
  status: m.settings_online_status_name(),
};
const keyRow = m.settings_online_key_name();
const upToDate = messagePattern(m.settings_online_status_up_to_date, {
  time: "",
});
const exactly = (text: string) => new RegExp(`^${RegExp.escape(text)}$`);
const startsWith = (text: string) => new RegExp(`^${RegExp.escape(text)}`);
const onlineRows = [
  names.source,
  keyRow,
  names.status,
  m.settings_online_language_name(),
  m.settings_online_remove_name(),
];

describe.skipIf(!reachable)("Zotero online library", () => {
  const vaultPath = e2eVaultDir(workspaceRoot, "online-library-vault");
  let vaultId = "";
  let api: OnlineLibraryApi;
  registerRunVaultGuard(() => vaultId, { leftovers: false });

  const openZoteroPage = () =>
    openProfilesSettings(vaultId, "settings_page_zotero");
  const rowsShow = (expected: readonly string[], what: string) =>
    librarySourceRows(vaultId, names, {
      ready: (shown: LibrarySourceRows) =>
        JSON.stringify(shown.rows) === JSON.stringify(expected),
      what,
    });
  const statusShows = (pattern: RegExp, what: string) =>
    onlineStatusShows(vaultId, { name: names.status, pattern, what });
  const syncNow = async () => {
    await clearNotices(vaultId);
    const pressed = await pressSettingRowAction(vaultId, {
      rowName: names.status,
      actionLabel: m.settings_online_sync_now(),
    });
    expect(pressed.buttons).toBe(1);
  };
  const searchUntil = (
    query: string,
    ready: (keys: string[]) => boolean,
    what: string,
  ) =>
    readUntil(
      async () => (await searchItems(vaultId, query)).map(({ key }) => key),
      ready,
      { what, tries: 120 },
    );
  const query = async (args: Record<string, string>) =>
    JSON.parse(
      await cliCommand(vaultId, "zotlit:query", { args }),
    ) as ItemQueryReport;
  const titleOf = async (key: string) =>
    ((await query({ filter: `indexedKey == "${key}"`, fields: "title" }))
      .rows?.[0]?.values.title as string | undefined) ?? null;
  const reloadWithButton = () =>
    reloadWindow(vaultId, (id) =>
      obRun(
        id,
        ({ app }, { row }) => {
          const button = [
            ...app.setting.containerEl.querySelectorAll<HTMLElement>(
              ".setting-item",
            ),
          ]
            .find(
              (el) =>
                el.querySelector(".setting-item-name")?.textContent === row,
            )
            ?.querySelector<HTMLButtonElement>("button");
          if (!button) return false;
          setTimeout(() => button.click());
          return true;
        },
        { row: m.settings_library_source_reload_name() },
      ),
    );
  const removeOnlineData = async () => {
    await obRun(
      vaultId,
      ({ app, page }, { row }) => {
        page.press(
          [
            ...app.setting.containerEl.querySelectorAll<HTMLElement>(
              ".setting-item",
            ),
          ].find(
            (el) => el.querySelector(".setting-item-name")?.textContent === row,
          ),
          row,
        );
      },
      { row: m.settings_online_remove_name() },
    );
    expect(
      await clickModalButton(
        vaultId,
        m.modal_online_remove_action(),
        "settings",
      ),
    ).toBe(true);
  };
  const secretCleared = () =>
    readUntil(
      () => secretState(SECOND_SECRET),
      (state) => state.kept && state.control === "",
      {
        what: "the key row to show the cleared secret at once, while the secret stays in the keychain",
      },
    );
  const secretState = (secret: string) =>
    obRun(
      vaultId,
      ({ app, page }, { secret, row }) => ({
        kept: app.secretStorage.getSecret(secret) !== null,
        control:
          page
            .settingRow(row)
            ?.querySelector(".setting-secret-value")
            ?.textContent?.trim() ?? null,
      }),
      { secret, row: keyRow },
    );
  const ensureOnlineSource = async () => {
    await setWebApiUrl(vaultId, api.url);
    await openZoteroPage();
    const reload = m.settings_library_source_reload_name();
    const shown = await librarySourceRows(vaultId, names, {
      ready: (rows) => rows.source !== null,
      what: "the Library source row",
    });
    if (shown.source === "web-api" && !shown.rows.includes(reload)) return;
    if (shown.source !== "web-api")
      await pickRowOption(vaultId, { name: names.source, value: "web-api" });
    await librarySourceRows(vaultId, names, {
      ready: (rows) => rows.rows.includes(reload),
      what: "the reload prompt for the online library",
    });
    await reloadWithButton();
    await openZoteroPage();
  };
  const accounts = {
    main: { secret: MAIN_SECRET, username: () => api.main.username },
    second: { secret: SECOND_SECRET, username: () => SECOND_ACCOUNT.username },
  } as const;
  const ensureOnline = async (account: keyof typeof accounts) => {
    const { secret, username } = accounts[account];
    const value = api.keys[account];
    await ensureOnlineSource();
    const changed = await obRun(
      vaultId,
      ({ app }, { secret, value }) => {
        const stored = app.secretStorage.getSecret(secret);
        if (stored === null || stored === value) return false;
        app.secretStorage.setSecret(secret, value);
        return true;
      },
      { secret, value },
    );
    if ((await secretState(secret)).control !== secret)
      await linkSecret(vaultId, { row: keyRow, name: secret, value });
    else if (changed) await syncNow();
    const accepted = m.settings_online_key_accepted({ username: username() });
    const consent = startsWith(m.settings_online_problem_account_changed());
    const ready = (rows: LibrarySourceRows) =>
      rows.status !== null &&
      upToDate.test(rows.status) &&
      rows.accepted === accepted;
    const what = `the online library of the ${account} account to be up to date`;
    const shown = await librarySourceRows(vaultId, names, {
      ready: (rows) =>
        ready(rows) || (rows.status !== null && consent.test(rows.status)),
      what,
      tries: 240,
    });
    if (ready(shown)) return;
    await pressSettingRowAction(vaultId, {
      rowName: m.settings_online_replace_name(),
      actionLabel: m.settings_online_replace_action(),
    });
    await librarySourceRows(vaultId, names, { ready, what, tries: 240 });
  };
  const ensureTitle = async (title: string) => {
    await ensureOnline("main");
    if ((await titleOf(targetItem.key)) === title) return;
    edit(api.main, targetItem.key, { title });
    await syncNow();
    await searchUntil(
      title,
      (keys) => keys.includes(targetItem.key),
      `Sync now to bring in the title "${title}"`,
    );
  };
  const openQueryNote = () =>
    obRun(
      vaultId,
      async ({ app }, { key, path }) => {
        app.setting.close();
        const block = (lines: string[]) =>
          ["```zotquery", ...lines, "```", ""].join("\n");
        const file =
          app.vault.getFileByPath(path) ??
          (await app.vault.create(
            path,
            [
              block([
                "views:",
                "  - type: table",
                "    name: Online item",
                "    from: items",
                `    filters: indexedKey == "${key}"`,
                "    order:",
                "      - title",
                "      - firstAuthor",
                "      - date",
                "    limit: 10",
              ]),
              block([
                "views:",
                "  - type: annotations",
                "    name: Online annotations",
                "    from: annotations",
                `    filters: item.indexedKey == "${key}"`,
                "    limit: 100",
              ]),
            ].join("\n"),
          ));
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file, { state: { mode: "preview" } });
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { key: annotationItem.key, path: QUERY_NOTE },
    );

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    const plugins = await installPlugins(
      workspaceRoot,
      vaultPath,
      pluginsOption.default,
    );
    const pack = await installWithoutEnabling(
      workspaceRoot,
      vaultPath,
      RESOURCE_PACK_ID,
    );
    const created = await runVaultScript(["open", vaultPath, plugins, pack]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await obRun(vaultId, ({ app }) => {
      app.vault.setConfig("nativeMenus", false);
    });
    await prepareRunWindow(vaultId);
    api = await startOnlineLibraryApi(e2eFixture.databasePath);
    api.main.user.updateItem(annotationItem.key, {
      title: ONLINE_ITEM.title,
      citationKey: ONLINE_ITEM.citationKey,
      creators: [
        {
          creatorType: "author",
          firstName: "Ola",
          lastName: ONLINE_ITEM.lastName,
        },
      ],
    });
    api.main.user.updateItem(annotationKeys[0]!, {
      annotationComment: ONLINE_ITEM.comment,
    });
  }, 180_000);

  afterAll(async () => {
    if (vaultId) {
      await closeOtherWindow(vaultId).catch(() => undefined);
      await obRun(
        vaultId,
        async ({ app }, { urlKey }) => {
          app.setting.close();
          for (const key of Object.keys(localStorage))
            if (
              key.startsWith(`${app.appId}-zotlit-`) &&
              /library-source|online-library|zotero-web-api/.test(key)
            )
              localStorage.removeItem(key);
          app.saveLocalStorage(urlKey, null);
          for (const name of app.secretStorage.listSecrets())
            (
              app.secretStorage as typeof app.secretStorage & {
                deleteSecret(id: string): void;
              }
            ).deleteSecret(name);
          await app.plugins.disablePlugin("zotlit");
          try {
            await (
              await (
                await navigator.storage.getDirectory()
              ).getDirectoryHandle("zotlit")
            ).removeEntry(app.appId, { recursive: true });
          } catch {
            return;
          }
        },
        { urlKey: WEB_API_URL_KEY },
      ).catch(() => undefined);
    }
    await api?.[Symbol.asyncDispose]();
    await runVaultScript(["remove", vaultPath, "--purge"]);
  }, 120_000);

  it("selects the Zotero online library on this device, takes the key through the secret control, and shows the first build until it is up to date", async () => {
    await setWebApiUrl(vaultId, api.url);
    await openZoteroPage();
    expect(
      await librarySourceRows(vaultId, names, {
        ready: (shown) => shown.source === "file",
        what: "the Library source to show Zotero on this computer",
      }),
    ).toMatchObject({ rows: [names.source], source: "file" });

    await pickRowOption(vaultId, { name: names.source, value: "web-api" });
    await rowsShow(
      [
        names.source,
        m.settings_library_source_reload_name(),
        keyRow,
        m.settings_online_language_name(),
        m.settings_online_remove_name(),
      ],
      "the online library rows and the reload prompt",
    );

    await reloadWithButton();
    await openZoteroPage();
    await rowsShow(onlineRows, "the rows of the online library after reload");
    await statusShows(
      exactly(m.settings_online_status_no_key()),
      "the online library to ask for the secret with the key",
    );
    expect(await replicaPoolFiles(vaultId)).toBeNull();

    const releaseCollections = api.main.hold(
      (request) => request.query.collectionKey !== undefined,
    );
    const releaseItems = api.main.hold(
      (request) => request.query.itemKey !== undefined,
    );
    try {
      await linkSecret(vaultId, {
        row: keyRow,
        name: MAIN_SECRET,
        value: api.keys.main,
      });
      await statusShows(
        messagePattern(m.settings_online_status_collections, {
          done: "",
          total: "",
        }),
        "the first build to show the download of collections",
      );
      releaseCollections();
      await statusShows(
        messagePattern(m.settings_online_status_items, {
          done: "",
          total: "",
        }),
        "the first build to show the download of items",
      );
    } finally {
      releaseCollections();
      releaseItems();
    }
    await statusShows(upToDate, "the first build to end up to date");
    expect((await librarySourceRows(vaultId, names)).accepted).toBe(
      m.settings_online_key_accepted({ username: api.main.username }),
    );
    expect(
      await obRun(
        vaultId,
        async ({ app }, { secret }) => ({
          data: await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/zotlit/data.json`,
          ),
          kept: app.secretStorage.getSecret(secret) !== null,
        }),
        { secret: MAIN_SECRET },
      ),
    ).toMatchObject({
      data: expect.not.stringMatching(
        new RegExp(`${api.keys.main}|${MAIN_SECRET}`),
      ),
      kept: true,
    });
    expect(api.requests().every(({ key }) => key !== "invalid")).toBe(true);
  }, 240_000);

  it("reads the replica in search, a citation, a Query View and the Library View, with the values of the fake library", async () => {
    await ensureOnline("main");
    await searchUntil(
      ONLINE_ITEM.title,
      (keys) => keys.includes(annotationItem.key),
      "the item search to find the annotated item in the replica",
    );
    expect(await searchItems(vaultId, ONLINE_ITEM.title)).toContainEqual({
      key: annotationItem.key,
      title: ONLINE_ITEM.title,
    });

    const inserted = await obRun(
      vaultId,
      async ({ app, page }, { title, key }) => {
        app.setting.close();
        const file = await app.vault.create("Online citations.md", "");
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const { editor } = leaf.view as import("obsidian").MarkdownView;
        editor.focus();
        app.commands.executeCommandById("zotlit:insert-citation");
        const input = await page.until("the insert citation dialog", () =>
          activeDocument.querySelector<HTMLInputElement>(".prompt-input"),
        );
        input.value = title;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const row = await page.until(
          "the item in the insert citation dialog",
          () =>
            activeDocument.querySelector<HTMLElement>(
              `.prompt-results [data-indexed-key="${key}"]`,
            ),
          15_000,
        );
        const shown = row.textContent;
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await page.until("the citation in the note", () =>
          editor.getValue().includes("@"),
        );
        return { shown, text: editor.getValue() };
      },
      { title: ONLINE_ITEM.title, key: annotationItem.key },
    );
    expect(inserted.shown).toContain(ONLINE_ITEM.title);
    expect(inserted.text).toContain(`@${ONLINE_ITEM.citationKey}`);
    const saved = await readUntil(
      () =>
        readFile(join(vaultPath, "Online citations.md"), "utf8").catch(
          () => null,
        ),
      (text) => text.includes(`@${ONLINE_ITEM.citationKey}`),
      { what: "the note on disk to hold the citation of the online item" },
    );
    expect(saved).not.toContain(annotationItem.citationKey);

    const fromQuery = await query({
      filter: `indexedKey == "${annotationItem.key}"`,
      fields: "title,creators,date,citationKey",
    });
    expect(fromQuery).toMatchObject({
      ok: true,
      identity: { source: { id: `web-api:${api.main.userID}` } },
      rows: [
        {
          indexedKey: annotationItem.key,
          values: expect.objectContaining({
            title: ONLINE_ITEM.title,
            citationKey: ONLINE_ITEM.citationKey,
          }),
        },
      ],
    });

    await openQueryNote();
    const table = await revealQueryView(vaultId, QUERY_NOTE, {
      block: 0,
    });
    const tableRow = await readQueryViewUntil(
      vaultId,
      async ({ page }, { view }) =>
        (await page.revealQueryView(view)).querySelector<HTMLElement>(
          '[data-query-table-row="item"]',
        )?.textContent ?? null,
      { view: table },
      {
        ready: (text) => text !== null,
        what: "the table row of the Query View",
      },
    );
    expect(tableRow).toContain(ONLINE_ITEM.title);
    expect(tableRow).toContain(ONLINE_ITEM.lastName);
    expect(tableRow).toContain(annotationItem.date);
    const cards = await revealQueryView(vaultId, QUERY_NOTE, {
      block: 1,
    });
    const shownCards = await readQueryViewUntil(
      vaultId,
      async ({ page }, { view }) =>
        [
          ...(await page.revealQueryView(view)).querySelectorAll<HTMLElement>(
            ".zt-annot-card",
          ),
        ]
          .map((card) => ({
            key: card.getAttribute("data-zotero-annotation-key")!,
            text: card.textContent,
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      { view: cards },
      {
        ready: (shown) => shown.length > 0,
        what: "the annotation cards of the Query View",
      },
    );
    expect(shownCards.map(({ key }) => key)).toEqual(
      [...annotationKeys].sort(),
    );
    expect(
      shownCards.find(({ key }) => key === annotationKeys[0])?.text,
    ).toContain(ONLINE_ITEM.comment);

    expect(
      await obRunUntil(
        vaultId,
        async ({ app }, { key }) => {
          if (app.workspace.getLeavesOfType("zotlit-library").length === 0)
            app.commands.executeCommandById("zotlit:open-library-view");
          const row = app.workspace
            .getLeavesOfType("zotlit-library")[0]
            ?.view.containerEl.querySelector<HTMLElement>(
              `[data-query-papers-row="${key}"]`,
            );
          return row?.textContent ?? null;
        },
        { key: DATED_ITEM.key },
        {
          ready: (text) => text !== null,
          what: "the Library View to list the newest item of the replica",
          tries: 120,
        },
      ),
    ).toContain(DATED_ITEM.title);

    expect(await replicaPoolFiles(vaultId)).not.toEqual([]);
  }, 240_000);

  it("runs the replica on opfs-sahpool in its Worker, with no OPFS warning in the Worker console", async () => {
    await ensureOnline("main");
    const probe = await probeWebWorker(vaultId, WEB_WORKER_NAME);
    expect(probe.found).toBe(true);
    expect(probe.vfs).toContain("opfs-sahpool");
    expect(probe.vfs).not.toContain("opfs");
    expect(probe.vfs).not.toContain("opfs-wl");
    expect(
      probe.console.filter((line) =>
        /Ignoring inability|OPFS asyncer/.test(line),
      ),
    ).toEqual([]);
    expect(probe.pool?.files).toEqual([REPLICA_FILE]);
  }, 120_000);

  it("brings an added, a changed and a deleted item in with Sync now and with the sync command", async () => {
    await ensureOnline("main");
    const changedTitle = `${targetItem.title}, revised online`;
    const doomed = DOOMED_ITEM;
    const doomedTitle = DOOMED_ITEM.title;
    expect(
      await searchUntil(
        doomedTitle,
        (keys) => keys.includes(doomed.key),
        "the item search to find the item that the fake library deletes next",
      ),
    ).toContain(doomed.key);
    expect(await titleOf(ADDED_KEY)).toBeNull();
    api.main.user.putItem(
      api.article({
        key: ADDED_KEY,
        title: "Added after the first build",
        date: "2026",
        lastName: "Newcomer",
        citationKey: "newcomerAdded2026",
      }),
    );
    edit(api.main, targetItem.key, { title: changedTitle });
    api.main.user.deleteItem(doomed.key);

    await openZoteroPage();
    await syncNow();
    await searchUntil(
      "Added after the first build",
      (keys) => keys.includes(ADDED_KEY),
      "Sync now to bring in the added item",
    );
    await searchUntil(
      changedTitle,
      (keys) => keys.includes(targetItem.key),
      "Sync now to bring in the changed title",
    );
    await searchUntil(
      doomedTitle,
      (keys) => !keys.includes(doomed.key),
      "Sync now to remove the deleted item",
    );
    await statusShows(upToDate, "the status after Sync now");
    expect(await titleOf(doomed.key)).toBeNull();

    edit(api.main, targetItem.key, { title: commandTitle });
    await clearNotices(vaultId);
    await obRun(vaultId, ({ app }) => {
      app.commands.executeCommandById("zotlit:sync-online-library");
    });
    await obRunUntil(
      vaultId,
      () =>
        [...document.querySelectorAll<HTMLElement>(".notice")].map(
          (notice) => notice.textContent,
        ),
      undefined,
      {
        ready: (texts) => texts.includes(m.notice_online_synced()),
        what: "the sync command to show its notice",
        tries: 120,
      },
    );
    await searchUntil(
      commandTitle,
      (keys) => keys.includes(targetItem.key),
      "the sync command to bring in the new title",
    );
  }, 240_000);

  it("syncs on the schedule while Obsidian has focus and waits while it has none", async () => {
    await ensureTitle(commandTitle);
    const restarted = api.requests().length;
    const passes = () =>
      api
        .requests()
        .slice(restarted)
        .filter(({ path }) => path === `/users/${api.main.userID}/settings`)
        .length;
    await turnZotlitOff(vaultId);
    await shortenSyncInterval(vaultId, SHORT_SYNC_INTERVAL_MS);
    try {
      await focusMainWindow(vaultId, true);
      await searchUntil(
        commandTitle,
        (keys) => keys.includes(targetItem.key),
        "the restarted online library to read the replica",
      );
      await readUntil(
        async () => passes(),
        (count) => count >= 2,
        {
          what: "the start-up sync and one scheduled sync to pass",
        },
      );
      edit(api.main, targetItem.key, { title: focusedTitle });
      await searchUntil(
        focusedTitle,
        (keys) => keys.includes(targetItem.key),
        "the schedule to bring in a change while Obsidian has focus",
      );

      await focusMainWindow(vaultId, false);
      await delay(SETTLE_MS);
      const before = api.requests().length;
      edit(api.main, targetItem.key, { title: awayTitle });
      await delay(FIVE_PASSES_MS);
      expect(api.requests().length).toBe(before);
      expect(
        (await searchItems(vaultId, focusedTitle)).map(({ key }) => key),
      ).toContain(targetItem.key);

      await focusMainWindow(vaultId, true);
      await searchUntil(
        awayTitle,
        (keys) => keys.includes(targetItem.key),
        "the schedule to sync when Obsidian has focus again",
      );
    } finally {
      await shortenSyncInterval(vaultId, null);
      await closeOtherWindow(vaultId);
    }
  }, 240_000);

  it("refuses the actions that Zotero on this computer sends, and still follows a Library Link", async () => {
    await ensureOnline("main");
    await clearNotices(vaultId);
    await obRun(vaultId, ({ app, zotlit }) => {
      const s = zotlit.services;
      app.workspace.protocolHandler.handlers.get("zotlit/open")!({
        action: "zotlit/open",
        item: "1",
        "source-id": s.bridge.runSync(s.zoteroPref.current).sourceId!,
      });
    });
    await obRunUntil(
      vaultId,
      () =>
        [...document.querySelectorAll<HTMLElement>(".notice")].map(
          (notice) => notice.textContent,
        ),
      undefined,
      {
        ready: (texts) => texts.includes(m.notice_needs_local_zotero()),
        what: "the link from Zotero to be refused",
      },
    );

    await obRun(
      vaultId,
      ({ app }, { key }) => {
        app.workspace.protocolHandler.handlers.get("zotlit/show-in-library")!({
          action: "zotlit/show-in-library",
          "item-key": key,
        });
      },
      { key: annotationItem.key },
    );
    expect(
      await obRunUntil(
        vaultId,
        async ({ app }, { key }) => {
          const view = (
            app.workspace.getLeavesOfType(
              "zotlit-library",
            ) as (WorkspaceLeaf & {
              view: LibraryView;
            })[]
          )[0]?.view;
          if (!view?.query) return null;
          await view.query.settled;
          if (view.selected.key !== key) return null;
          return (
            view.containerEl.querySelector<HTMLElement>(
              `[data-query-papers-row="${key}"]`,
            )?.textContent ?? null
          );
        },
        { key: annotationItem.key },
        {
          ready: (text) => text !== null,
          what: "the Library Link to show the item in the Library View",
        },
      ),
    ).toContain(ONLINE_ITEM.title);
  }, 120_000);

  it("keeps the replica over a restart of Obsidian and reads it before any request", async () => {
    await ensureTitle(awayTitle);
    const files = await replicaPoolFiles(vaultId);
    const release = api.main.hold(() => true);
    const before = api.requests().length;
    try {
      await reloadWindow(vaultId);
      await searchUntil(
        awayTitle,
        (keys) => keys.includes(targetItem.key),
        "the restarted window to read the stored replica while no request is answered",
      );
    } finally {
      release();
    }
    await openZoteroPage();
    await statusShows(upToDate, "the status after the restart");
    const since = api.requests().slice(before);
    expect(
      since.filter(
        ({ query }) =>
          query.itemKey !== undefined || query.collectionKey !== undefined,
      ),
    ).toEqual([]);
    expect(since.find(({ path }) => path.endsWith("/settings"))).toMatchObject({
      ifModifiedSinceVersion: expect.any(Number),
    });
    expect(await replicaPoolFiles(vaultId)).toEqual(files);
  }, 180_000);

  it("builds the replica again in a new Zotero language and reads the date in it", async () => {
    const dateOf = async () =>
      (
        await query({
          filter: `indexedKey == "${DATED_ITEM.key}"`,
          fields: "date",
        })
      ).rows?.[0]?.values.date as { value: string; raw: string } | undefined;
    const rebuild = async (language: string, old: string, value: string) => {
      const before = api.requests().length;
      const watched = await probeWebWorker(vaultId, WEB_WORKER_NAME, {
        watchPool: true,
      });
      const start = watched.pool?.peak;
      expect(start?.files).toContain(REPLICA_FILE);
      await recordReads(vaultId);
      const itemVersions = (request: { path: string; query: object }) =>
        request.path === `/users/${api.main.userID}/items` &&
        (request.query as { format?: string }).format === "versions";
      const release = api.main.hold(itemVersions);
      try {
        await pickRowOption(vaultId, {
          name: m.settings_online_language_name(),
          value: language,
        });
        await readUntil(
          async () => api.requests().slice(before),
          (since) => since.some(itemVersions),
          {
            what: `the rebuild in ${language} to ask for the item versions`,
          },
        );
        expect(await dateOf()).toMatchObject({ value: old });
        expect(await searchItems(vaultId, ONLINE_ITEM.title)).toContainEqual({
          key: annotationItem.key,
          title: ONLINE_ITEM.title,
        });
      } finally {
        release();
      }
      await readUntil(
        () => dateOf().catch(() => null),
        (date) => date?.value === value,
        {
          what: `the rebuild in ${language} to commit the date`,
          tries: 240,
        },
      );
      await statusShows(upToDate, `the rebuild in ${language} to end`);
      const seen = await recordedReads(vaultId, { stop: true });
      expect(seen).toContain("changed");
      expect(seen).toContain("state:ready");
      expect(seen).not.toContain("state:loading");
      const { pool } = await probeWebWorker(vaultId, WEB_WORKER_NAME);
      console.log(
        `pool slots in use at the peak of the rebuild in ${language}: ${pool?.peak?.size} of ${pool?.capacity} ${JSON.stringify(pool?.peak?.files)}`,
      );
      expect(pool?.peak).not.toBeNull();
      expect(pool!.peak!.size).toBeGreaterThan(start!.size);
      expect(pool!.peak!.size).toBeLessThan(pool!.capacity);
    };

    await ensureOnline("main");
    const pool = await replicaPoolFiles(vaultId);
    await rebuild("en-GB", "2020-01-02", "2020-02-01");
    const british = await dateOf();
    await rebuild("en-US", "2020-02-01", "2020-01-02");
    const american = await dateOf();
    expect({ british, american }).toMatchObject({
      british: { value: "2020-02-01", raw: `2020-02-01 ${DATED_ITEM.date}` },
      american: { value: "2020-01-02", raw: `2020-01-02 ${DATED_ITEM.date}` },
    });
    expect(await replicaPoolFiles(vaultId)).toEqual(pool);
  }, 240_000);

  it("removes the personal library when the key reads only groups, keeps the group, and brings the personal library back with the grant", async () => {
    await ensureOnline("main");
    const found = async (title: string) =>
      (await searchItems(vaultId, title)).some((hit) => hit.title === title);
    const both = async () => ({
      personal: await found(DATED_ITEM.title),
      group: await found(GROUP_ITEM.title),
    });
    expect(await both()).toEqual({ personal: true, group: true });
    try {
      api.main.addKey(api.keys.main, GROUPS_ONLY);
      await syncNow();
      expect(
        await readUntil(both, (shown) => !shown.personal, {
          what: "Sync now to remove the personal library of a key that reads only groups",
          tries: 120,
        }),
      ).toEqual({ personal: false, group: true });
      await statusShows(
        upToDate,
        "the sync for the key that reads only groups to end",
      );
    } finally {
      api.main.addKey(api.keys.main, READ_ALL);
    }
    await syncNow();
    expect(
      await readUntil(both, (shown) => shown.personal, {
        what: "Sync now to bring the personal library back with the grant",
        tries: 120,
      }),
    ).toEqual({ personal: true, group: true });
    await statusShows(upToDate, "the status after the grant returns");
  }, 240_000);

  it("shows a group renamed online in the Library View after Sync now, with no reload", async () => {
    await ensureOnline("main");
    const renamed = "Reading circle renamed online";
    const tree = (ready: (text: string) => boolean, what: string) =>
      obRunUntil(
        vaultId,
        ({ app }) => {
          if (app.workspace.getLeavesOfType("zotlit-library").length === 0)
            app.commands.executeCommandById("zotlit:open-library-view");
          return (
            app.workspace
              .getLeavesOfType("zotlit-library")[0]
              ?.view.containerEl.querySelector<HTMLElement>(
                "[data-library-tree]",
              )?.textContent ?? null
          );
        },
        undefined,
        { ready: (text) => text !== null && ready(text), what, tries: 120 },
      );
    const group = api.main.library({ type: "group", id: GROUP_ITEM.groupID });
    const before = group.group!;
    expect(
      await tree(
        (text) => text.includes(before.data.name),
        "the Library View to list the group",
      ),
    ).not.toContain(renamed);
    await obRun(vaultId, ({ app }) => {
      const { view } = app.workspace.getLeavesOfType("zotlit-library")[0]!;
      (view as typeof view & { e2eMark?: true }).e2eMark = true;
    });
    group.group = {
      ...before,
      version: before.version + 1,
      data: { ...before.data, name: renamed },
    };
    await openZoteroPage();
    await syncNow();
    expect(
      await tree(
        (text) => text.includes(renamed),
        "the Library View to show the new group name",
      ),
    ).not.toContain(before.data.name);
    expect(
      await obRun(vaultId, ({ app }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]?.view;
        return (view as { e2eMark?: true } | undefined)?.e2eMark ?? false;
      }),
    ).toBe(true);
  }, 120_000);

  it("offers to replace the data for a key of another account, and replaces the replica with that account's library", async () => {
    await ensureOnline("main");
    await linkSecret(vaultId, {
      row: keyRow,
      name: SECOND_SECRET,
      value: api.keys.second,
    });
    await statusShows(
      startsWith(m.settings_online_problem_account_changed()),
      "the key of another account to wait for consent",
    );
    expect(await searchItems(vaultId, ONLINE_ITEM.title)).toContainEqual({
      key: annotationItem.key,
      title: ONLINE_ITEM.title,
    });
    await rowsShow(
      [
        names.source,
        keyRow,
        names.status,
        m.settings_online_replace_name(),
        m.settings_online_language_name(),
        m.settings_online_remove_name(),
      ],
      "the offer to use the new account",
    );
    await pressSettingRowAction(vaultId, {
      rowName: m.settings_online_replace_name(),
      actionLabel: m.settings_online_replace_action(),
    });
    await statusShows(upToDate, "the replica of the new account");
    await rowsShow(onlineRows, "the offer to go away");
    expect((await librarySourceRows(vaultId, names)).accepted).toBe(
      m.settings_online_key_accepted({ username: SECOND_ACCOUNT.username }),
    );
    await searchUntil(
      SECOND_ITEM.title,
      (keys) => keys.includes(SECOND_ITEM.key),
      "the item search to read the library of the new account",
    );
    expect(
      (
        await query({
          filter: `indexedKey == "${SECOND_ITEM.key}"`,
          fields: "title",
        })
      ).identity?.source.id,
    ).toBe(`web-api:${SECOND_ACCOUNT.userID}`);
    expect(
      (await searchItems(vaultId, ONLINE_ITEM.title)).map(({ key }) => key),
    ).not.toContain(annotationItem.key);
    expect(
      await obRun(vaultId, ({ app }) =>
        app.loadLocalStorage("zotlit-online-library-account"),
      ),
    ).toBe(SECOND_ACCOUNT.userID);
  }, 240_000);

  it("names a refused key, a key without access and a rate wait, and keeps the last good data", async () => {
    await ensureOnline("second");
    const setSecret = (value: string) =>
      obRun(
        vaultId,
        ({ app }, { name, value }) => {
          app.secretStorage.setSecret(name, value);
        },
        { name: SECOND_SECRET, value },
      );
    const lastGood = (problem: string) =>
      new RegExp(
        `^${RegExp.escape(problem)} ${messagePattern(
          m.settings_online_status_last_good,
          { time: "" },
        ).source.slice(1)}`,
      );

    await setSecret(api.keys.unknown);
    await syncNow();
    await statusShows(
      lastGood(m.settings_online_problem_key_invalid()),
      "a refused key with the last good data",
    );
    expect(await titleOf(SECOND_ITEM.key)).toBe(SECOND_ITEM.title);

    await setSecret(api.keys.secondNoAccess);
    await syncNow();
    await statusShows(
      lastGood(m.settings_online_problem_no_access()),
      "a key with no read access",
    );

    await setSecret(api.keys.second);
    api.second.inject({
      match: ({ path, query }) =>
        path.endsWith("/items") && query.format === "versions",
      times: 2,
      answer: { status: 429, headers: { "Retry-After": "4" } },
    });
    edit(api.second, SECOND_ITEM.key, {
      title: "Synced after the rate wait",
    });
    const before = api.second.requests.length;
    await syncNow();
    await statusShows(
      messagePattern(m.settings_online_status_rate_wait, { time: "" }),
      "the status to name the rate wait and when the sync continues",
    );
    await searchUntil(
      "Synced after the rate wait",
      (keys) => keys.includes(SECOND_ITEM.key),
      "the sync to go on after the rate wait",
    );
    await statusShows(upToDate, "the status after the rate wait");
    expect(
      api.second.requests.slice(before).filter(({ status }) => status === 429),
    ).toHaveLength(2);
  }, 240_000);

  it("names each state of the Resource Pack, and removes the online library data when no Worker runs", async () => {
    await ensureOnline("second");
    await keepRunPack(vaultId, { file: true });
    let restored = false;
    try {
      for (const [variant, text] of [
        ["older", m.settings_resource_pack_status_pack_outdated()],
        ["newer", m.settings_resource_pack_status_plugin_outdated()],
        ["malformed", m.settings_resource_pack_status_damaged()],
      ] as const) {
        await installPackVariant(vaultId, variant);
        await restartZotlit(vaultId, { asUpdated: false });
        await openZoteroPage();
        await statusShows(exactly(text), `the status with a ${variant} pack`);
      }
      await obRun(
        vaultId,
        ({ app }, { packId }) => {
          delete app.plugins.manifests[packId];
          app.plugins.didChange();
        },
        { packId: RESOURCE_PACK_ID },
      );
      await restartZotlit(vaultId, { asUpdated: false });
      await openZoteroPage();
      await statusShows(
        exactly(m.settings_resource_pack_status_absent()),
        "the status with no pack",
      );
      expect(await replicaPoolNames(vaultId)).toEqual([REPLICA_FILE]);
      await openQueryNote();
      const failed = await readQueryViewUntil(
        vaultId,
        async ({ page }, { view }) =>
          (await page.revealQueryView(view)).querySelector<HTMLElement>(
            "[data-query-diagnostic]",
          )?.textContent ?? null,
        {
          view: await revealQueryView(vaultId, QUERY_NOTE, { block: 0 }),
        },
        {
          ready: (text) => text !== null,
          what: "the Query View to explain why it shows no result",
        },
      );
      expect(failed).toContain(m.query_view_failed());
      expect(failed).toContain(m.query_view_failure_library_unavailable());
      expect(failed).not.toMatch(/zotlit:|--\w/);
      await openZoteroPage();

      await removeOnlineData();
      await statusShows(
        exactly(m.settings_online_status_no_key()),
        "the no-key state after the removal with no Worker",
      );
      expect(await replicaPoolFiles(vaultId)).toBeNull();
      await secretCleared();
      expect(
        await obRun(vaultId, ({ app }) =>
          app.loadLocalStorage("zotlit-online-library-account"),
        ),
      ).toBeNull();

      await restoreRunPack(vaultId, m.notice_resource_pack());
      restored = true;
    } finally {
      if (!restored) await restoreRunPack(vaultId, m.notice_resource_pack());
    }
    await restartZotlit(vaultId, { asUpdated: false });
    await openZoteroPage();
    await statusShows(
      exactly(m.settings_online_status_no_key()),
      "the online library with no key after the pack returns",
    );
  }, 300_000);

  it("removes the online library data while its Worker runs, keeps the secret, and leaves only an empty replica in OPFS: no item, no synced library, no account of Zotero", async () => {
    await ensureOnline("second");
    const restarted = api.requests().length;
    await turnZotlitOff(vaultId);
    await shortenSyncInterval(vaultId, SHORT_SYNC_INTERVAL_MS);
    try {
      await focusMainWindow(vaultId, true);
      await readUntil(
        async () =>
          api
            .requests()
            .slice(restarted)
            .filter(
              ({ path }) => path === `/users/${SECOND_ACCOUNT.userID}/settings`,
            ).length,
        (passes) => passes >= 2,
        {
          what: "the start-up sync and one pass of the shortened schedule before the removal",
        },
      );
      await openZoteroPage();
      await statusShows(upToDate, "the status before the removal");
      const held = await titleOf(SECOND_ITEM.key);
      expect(held).not.toBeNull();
      expect(await replicaPoolHolds(vaultId, held!)).toBe(true);

      await removeOnlineData();
      await statusShows(
        exactly(m.settings_online_status_no_key()),
        "the no-key state after the removal",
      );
      const requests = api.requests().length;
      await secretCleared();
      expect(await replicaPoolHolds(vaultId, held!)).toBe(false);
      await readUntil(
        async () => ({
          title: await titleOf(SECOND_ITEM.key).catch(() => null),
        }),
        (read) => read.title === null,
        { what: "the online library to read no item after the removal" },
      );
      await delay(FIVE_PASSES_MS);
      expect(api.requests().length).toBe(requests);
    } finally {
      await shortenSyncInterval(vaultId, null);
    }

    const replica = await replicaFileBytes(vaultId, REPLICA_FILE);
    expect(replica).not.toBeNull();
    const rows = replicaRowCounts(replica!);
    expect(rows).toMatchObject({
      items: 0,
      libraryRows: [{ libraryID: 1, type: "user", version: 0, lastSync: 0 }],
    });
    expect(
      (rows.accountRows as { key: string }[]).map(({ key }) => key),
    ).toEqual(["localUserKey"]);
  }, 240_000);

  it("reads the Zotero database file again after the source returns to Zotero on this computer", async () => {
    await ensureOnlineSource();
    await pickRowOption(vaultId, { name: names.source, value: "file" });
    await rowsShow(
      [names.source, m.settings_library_source_reload_name()],
      "the reload prompt for the file source",
    );
    await reloadWithButton();
    await openZoteroPage();
    await librarySourceRows(vaultId, names, {
      ready: (shown) => shown.rows.length === 1 && shown.source === "file",
      what: "the Library source group of the file source",
    });
    await searchUntil(
      targetItem.title,
      (keys) => keys.includes(targetItem.key),
      "the item search to read the Zotero database file",
    );
    expect(
      (
        await query({
          filter: `indexedKey == "${targetItem.key}"`,
          fields: "title",
        })
      ).identity?.source.id,
    ).not.toMatch(/^web-api:/);
  }, 180_000);
});
