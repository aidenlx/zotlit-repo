#!/usr/bin/env node

import type { DesktopSlot } from "#desktop-slot";
import type { VaultEntry } from "#obsidian-vault-registry";
import type { VaultPlugin } from "#vault-plugins";
import { access, cp, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as v from "valibot";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { frontmatterFieldSchema } from "@zotlit/templates/constants";
import type { FrontmatterField } from "@zotlit/templates/constants";

import { acquireDesktopSlotOrExit } from "#desktop-slot";
import {
  DEV_VAULT_CASE_ENV,
  getDevVaultDir,
  getFixtureVaultDir,
} from "#dev-vault";
import {
  buildFixture,
  DEFAULT_SCOPE_CASE,
  DEFAULT_VAULT_CASE,
  FIXTURE_LOCAL_API_SERVER_ID,
  FIXTURE_LOCAL_API_WRITE_KEY,
  getFixtureLayout,
  getFixtureRoot,
  SCOPE_CASES,
  VAULT_CASES,
} from "#fixture";
import { holdsZotLit } from "#fixture/layout";
import { createObsidianCall, isObsidianUnreachable } from "#obsidian-cli";
import {
  createObsidianHostReadiness,
  OBSIDIAN_HOST_TIMEOUT_MS,
  OBSIDIAN_HOST_VAULT_ENV,
  OBSIDIAN_VAULT_OPEN_TIMEOUT_MS,
} from "#obsidian-host-readiness";
import { findVaultId, unregisterVaultFile } from "#obsidian-vault-registry";
import { getWorkspaceRoot } from "#package-roots";
import {
  installOption,
  pluginsOption,
  resolveVaultPlugins,
} from "#vault-plugins";
import { purgeVault } from "#vault-purge";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);

const defaultVault = getDevVaultDir(workspaceRoot);
let fixtureLayout = getFixtureLayout(getFixtureRoot(workspaceRoot));
let fixtureVault = getFixtureVaultDir(workspaceRoot);
let inactive = false;
const pluginId = "zotlit";
const defaultPlugins = await resolveVaultPlugins(
  workspaceRoot,
  pluginsOption.default,
);
const sandboxFolder = "Obsidian Sandbox";

function obsidianUserData(): string {
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "obsidian",
    );
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "obsidian");
  }
  if (process.platform === "linux") {
    return join(
      process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
      "obsidian",
    );
  }
  throw new Error(
    `unsupported platform for vault cleanup: ${process.platform}`,
  );
}

const cli = createObsidianCall();

function rethrowUnreachable(error: unknown): undefined {
  if (isObsidianUnreachable(error)) throw error;
  return undefined;
}

async function readVaultRegistry(): Promise<Record<string, VaultEntry>> {
  const configPath = join(obsidianUserData(), "obsidian.json");
  const raw = await readFile(configPath, "utf-8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  if (raw === undefined) return {};

  const config = JSON.parse(raw) as { vaults?: Record<string, VaultEntry> };
  return config.vaults ?? {};
}

const checkObsidianHost = createObsidianHostReadiness(
  {
    pathExists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    readRegistry: readVaultRegistry,
    runObsidian: (args, signal) => cli(args, { signal }),
  },
  { sandboxVaultPath: join(obsidianUserData(), sandboxFolder) },
);

async function obEval(code: string, target?: string): Promise<string> {
  const text = await cli([
    ...(target ? [`vault=${target}`] : []),
    "eval",
    `code=${code}`,
  ]);
  if (text === "") return "";
  if (!text.startsWith("=> ")) {
    throw new Error(`obsidian eval failed: ${text}`);
  }
  return text.slice(3);
}

function vaultOpenCode(abs: string): string {
  const open = `require('electron').ipcRenderer.sendSync('vault-open',${JSON.stringify(abs)},false)`;
  if (!inactive) return open;
  return `(()=>{const remote=require('@electron/remote');const off=remote.require('vm').runInThisContext('(app)=>{const hook=(_event,win)=>{win.webContents.setBackgroundThrottling(false);win.show=()=>{win.showInactive();if(process.platform==="darwin")win.blur();};win.focus=()=>{};};app.on("browser-window-created",hook);return ()=>app.off("browser-window-created",hook);}')(remote.app);try{return ${open};}finally{off();}})()`;
}

function isObsidianRunning(): Promise<boolean> {
  return cli(["eval", "code=true"]).then(
    () => true,
    (error: unknown) => {
      rethrowUnreachable(error);
      return false;
    },
  );
}

async function vaultList(host?: string): Promise<Record<string, VaultEntry>> {
  const raw = await obEval(
    `require('electron').ipcRenderer.sendSync('vault-list')`,
    host,
  );
  return JSON.parse(raw) as Record<string, VaultEntry>;
}

async function waitFor(
  check: () => Promise<boolean>,
  tries = 40,
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await check()) return true;
    await delay(250);
  }
  return false;
}

async function resolveHost(avoidPath?: string): Promise<string> {
  return (await checkObsidianHost({ avoidPath })).id;
}

async function resolveRemovalHost(abs: string): Promise<string>;
async function resolveRemovalHost(
  abs: string,
  exclude: string,
): Promise<string | undefined>;
async function resolveRemovalHost(
  abs: string,
  exclude?: string,
): Promise<string | undefined> {
  const preferred = process.env[OBSIDIAN_HOST_VAULT_ENV];
  if (preferred) {
    const id = await obEval("app.appId", preferred);
    if (id === exclude) {
      throw new Error(
        `${OBSIDIAN_HOST_VAULT_ENV} points at the vault being removed`,
      );
    }
    return id;
  }

  const focused = await resolveHost(abs);
  if (focused !== exclude) return focused;

  const vaults = await vaultList(focused);
  return Object.keys(vaults).find((id) => id !== exclude && vaults[id]!.open);
}

interface SeedOptions {
  purge?: boolean;
  scopeCase?: string;
  vaultCase?: string;
  liveUpdatePort?: number;
  zoteroHttpPort?: number;
  localApi?: boolean;
  grantLocalApiWrites?: boolean;
  upgraderFields?: readonly FrontmatterField[];
  plugins?: readonly VaultPlugin[];
  installed?: readonly VaultPlugin[];
}

async function create(
  vaultPath: string,
  {
    purge = false,
    scopeCase = DEFAULT_SCOPE_CASE,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins = defaultPlugins,
    installed = [],
  }: SeedOptions = {},
): Promise<void> {
  const abs = resolve(vaultPath);
  const host = await resolveHost();
  const vaults = await vaultList(host);

  const existing = findVaultId(vaults, abs);
  if (existing) throw new Error(`already registered as ${existing}: ${abs}`);

  const name = basename(abs);
  const clash = Object.keys(vaults).find(
    (id) => basename(resolve(vaults[id]!.path)) === name,
  );
  if (clash) {
    throw new Error(
      `vault name "${name}" is taken by ${clash} at ${vaults[clash]!.path}. Rename this worktree folder.`,
    );
  }

  await rebuildFixtureVault(abs, {
    scopeCase,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins,
    installed,
  });
  if (purge) {
    const exists = await access(abs).then(
      () => true,
      () => false,
    );
    if (exists) await purgeVault(abs);
  }

  await mkdir(join(abs, ".obsidian", "plugins"), { recursive: true });
  if (abs !== resolve(fixtureVault)) {
    await cp(fixtureVault, abs, { recursive: true, force: false });
  }

  for (const { id, app } of [...plugins, ...installed]) {
    const bundle = join(abs, ".obsidian", "plugins", id, "main.js");
    await access(bundle).catch(() => {
      throw new Error(
        `${id} is not built into ${abs}. Run 'pnpm --filter ./${app} build:dev' first.`,
      );
    });
  }

  const opened = await obEval(vaultOpenCode(abs), host);
  if (opened !== "true") {
    throw new Error(`vault-open refused: ${opened || "unknown error"}`);
  }

  let registered: string | undefined;
  await waitFor(async () => {
    registered = findVaultId(await vaultList(host), abs);
    return Boolean(registered);
  });
  if (!registered) {
    throw new Error(`vault registered but no id appeared for ${abs}`);
  }
  const id = registered;
  const windowOpen = await waitFor(
    async () => (await vaultList(host))[id]?.open === true,
  );
  if (!windowOpen) {
    throw new Error(`vault ${id} registered but its window never opened`);
  }

  console.log(id);
  console.error(`created vault ${id} at ${abs}`);

  const answered = await waitFor(async () => {
    const state = await cli([`vault=${id}`, "plugins:restrict"]);
    return state === "on" || state === "off";
  });
  if (!answered) {
    throw new Error(`vault ${id} opened but never answered plugins:restrict`);
  }

  const trustedPage = await obEval("String(performance.timeOrigin)", id);
  const trusted = await cli([`vault=${id}`, "plugins:restrict", "off"]);
  if (!/disabled|^off$/i.test(trusted)) {
    throw new Error(`could not leave Restricted Mode in ${id}: ${trusted}`);
  }
  const reloads = /reloading/i.test(trusted);

  let reloaded = !reloads;
  const ids = JSON.stringify(plugins.map((plugin) => plugin.id));
  const loaded = await waitFor(async () => {
    const answer = await obEval(
      `JSON.stringify([String(performance.timeOrigin),${ids}.every(function(id){return id in app.plugins.plugins})])`,
      id,
    ).catch(rethrowUnreachable);
    if (!answer) return false;
    const [page, present] = JSON.parse(answer) as [string, boolean];
    reloaded ||= page !== trustedPage;
    return reloaded && present;
  });
  if (!reloaded) {
    throw new Error(
      `vault ${id} left Restricted Mode but its window never reloaded`,
    );
  }
  if (!loaded) {
    throw new Error(
      `${plugins.map((plugin) => plugin.id).join(", ")} did not load in ${id}. Run ${plugins.map((plugin) => `'pnpm --filter ./${plugin.app} build:dev'`).join(" and ")} and create again.`,
    );
  }
  if (holdsZotLit(plugins)) await linkFixture(id);
  if (localApi) {
    await setFixtureWriteAuthorization(id, grantLocalApiWrites ?? true);
  }
}

async function suspendLoadedPlugin(
  abs: string,
  plugins: readonly VaultPlugin[],
  { always = false }: { always?: boolean } = {},
): Promise<AsyncDisposableStack> {
  await using suspension = new AsyncDisposableStack();
  if (
    (!always && process.platform !== "win32") ||
    !(await isObsidianRunning())
  ) {
    return suspension.move();
  }

  const host = await resolveHost();
  const vaults = await vaultList(host);
  const id = findVaultId(vaults, abs);
  if (!id || vaults[id]?.open !== true) return suspension.move();

  for (const { id: plugin } of [...plugins].reverse()) {
    const loaded = await obEval(
      `String(${JSON.stringify(plugin)} in app.plugins.plugins)`,
      id,
    ).catch(rethrowUnreachable);
    if (loaded !== "true") continue;

    const disabled = await cli([
      `vault=${id}`,
      "plugin:disable",
      `id=${plugin}`,
    ]);
    if (!disabled.toLowerCase().startsWith("disabled:")) {
      throw new Error(`could not disable ${plugin} in ${id}: ${disabled}`);
    }
    suspension.defer(async () => {
      const enabled = await cli([
        `vault=${id}`,
        "plugin:enable",
        `id=${plugin}`,
      ]);
      if (!enabled.toLowerCase().startsWith("enabled:")) {
        throw new Error(`could not re-enable ${plugin} in ${id}: ${enabled}`);
      }
    });
  }
  return suspension.move();
}

async function sync(
  vaultPath: string,
  {
    purge = false,
    scopeCase = DEFAULT_SCOPE_CASE,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins = defaultPlugins,
    installed = [],
  }: SeedOptions = {},
): Promise<void> {
  const abs = resolve(vaultPath);
  const host = await resolveHost();

  await access(abs).catch(() => {
    throw new Error(`no vault at ${abs}. Run 'create' first.`);
  });

  {
    await using _pluginSuspension = await suspendLoadedPlugin(abs, plugins, {
      always: purge,
    });
    await rebuildFixtureVault(abs, {
      scopeCase,
      vaultCase,
      liveUpdatePort,
      zoteroHttpPort,
      localApi,
      grantLocalApiWrites,
      upgraderFields,
      plugins,
      installed,
    });

    if (purge) {
      const registered = findVaultId(await vaultList(host), abs);
      await purgeVault(abs);
      if (registered) {
        await clearVaultStorage(registered, host, { keyPrefix: pluginId });
      }
      await mkdir(abs, { recursive: true });
    }

    if (abs !== resolve(fixtureVault)) {
      await cp(fixtureVault, abs, { recursive: true, force: true });
    }
  }

  console.error(`synced ${fixtureVault} -> ${abs}`);
}

async function rebuildFixtureVault(
  target: string,
  {
    scopeCase = DEFAULT_SCOPE_CASE,
    vaultCase = DEFAULT_VAULT_CASE,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins = defaultPlugins,
    installed = [],
  }: SeedOptions = {},
): Promise<void> {
  if (resolve(target) === resolve(fixtureVault)) return;

  const hasBundle = (dir: string) =>
    access(join(dir, "main.js")).then(
      () => true,
      () => false,
    );
  const bundlesOf = async (list: readonly VaultPlugin[]) => {
    const bundles = [];
    for (const { id, devBundleDir } of list) {
      const vaultBundleDir = join(resolve(target), ".obsidian", "plugins", id);
      if (await hasBundle(devBundleDir)) {
        bundles.push({ id, bundleDir: devBundleDir });
      } else if (await hasBundle(vaultBundleDir)) {
        bundles.push({ id, bundleDir: vaultBundleDir });
      }
    }
    return bundles;
  };
  await buildFixture(fixtureLayout, {
    scopeCase,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    linkedAttachmentVaultDir: resolve(target),
    plugins: await bundlesOf(plugins),
    installed: await bundlesOf(installed),
  });
}

async function open(
  vaultPath: string,
  {
    purge = false,
    scopeCase = DEFAULT_SCOPE_CASE,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins = defaultPlugins,
    installed = [],
  }: SeedOptions = {},
): Promise<void> {
  const abs = resolve(vaultPath);
  const host = await resolveHost();
  const registered = findVaultId(await vaultList(host), abs);

  const seed = {
    purge,
    scopeCase,
    vaultCase,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
    upgraderFields,
    plugins,
    installed,
  };
  if (!registered) {
    await create(abs, seed);
    return;
  }

  await sync(abs, seed);
  const opened =
    (await vaultList(host))[registered]?.open === true
      ? undefined
      : await obEval(vaultOpenCode(abs), host);
  if (opened !== undefined) {
    if (opened !== "true") {
      throw new Error(`vault-open refused: ${opened || "unknown error"}`);
    }
    const windowOpen = await waitFor(
      async () => (await vaultList(host))[registered]?.open === true,
    );
    if (!windowOpen) {
      throw new Error(
        `vault ${registered} registered but its window never opened`,
      );
    }
  }

  for (const { id } of plugins) {
    let reloaded = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      reloaded = await cli([
        `vault=${registered}`,
        "plugin:reload",
        `id=${id}`,
      ]);
      if (reloaded.toLowerCase().startsWith("reloaded:")) break;
      await delay(250);
    }
    if (!reloaded.toLowerCase().startsWith("reloaded:")) {
      throw new Error(`could not reload ${id} in ${registered}: ${reloaded}`);
    }

    const loaded = await waitFor(async () => {
      const answer = await obEval(
        `String(${JSON.stringify(id)} in app.plugins.plugins)`,
        registered,
      ).catch(rethrowUnreachable);
      return answer === "true";
    });
    if (!loaded) {
      throw new Error(`${id} did not load in ${registered}`);
    }
  }
  if (holdsZotLit(plugins)) {
    await linkFixture(registered);
  }
  if (localApi) {
    await setFixtureWriteAuthorization(registered, grantLocalApiWrites ?? true);
  }

  console.log(registered);
  console.error(`opened vault ${registered} at ${abs}`);
}

interface FixtureLinkReport {
  databasePath?: unknown;
  dbState?: unknown;
  profileDir?: unknown;
}

async function linkFixture(vaultId: string): Promise<void> {
  const profileDir = fixtureLayout.profileDir;
  const databasePath = fixtureLayout.databasePath;
  const dataDir = fixtureLayout.dataDir;
  const configured = await waitFor(async () => {
    const answer = await obEval(
      `{const services=app.plugins.plugins.${pluginId}.services;const pref=services.zoteroPref;services.bridge.runSync(pref.setProfileDir(${JSON.stringify(profileDir)}));services.bridge.runSync(pref.setDataDir(${JSON.stringify(dataDir)}));"configured"}`,
      vaultId,
    ).catch(rethrowUnreachable);
    return answer === "configured";
  });
  if (!configured) {
    throw new Error(`could not configure Fixture paths in ${vaultId}`);
  }

  const resolved = await waitFor(async () => {
    const report = await readFixtureLink(vaultId).catch(rethrowUnreachable);
    return (
      report?.profileDir === profileDir && report.databasePath === databasePath
    );
  });
  if (!resolved) {
    throw new Error(
      `ZotLit in ${vaultId} did not resolve the Fixture profile and database`,
    );
  }

  const refreshed = await waitFor(async () => {
    const raw = await obEval(
      `(async()=>{const services=app.plugins.plugins.${pluginId}.services;await services.bridge.runPromise(services.zoteroReads.refresh).catch(()=>{});return JSON.stringify({profileDir:services.bridge.runSync(services.zoteroPref.current).resolvedProfileDir,databasePath:services.bridge.runSync(services.zoteroPref.current).databasePath,dbState:services.bridge.runSync(services.zoteroReads.current).state})})()`,
      vaultId,
    ).catch(rethrowUnreachable);
    if (!raw) return false;
    const report = JSON.parse(raw) as FixtureLinkReport;
    return (
      report.profileDir === profileDir &&
      report.databasePath === databasePath &&
      report.dbState === "ready"
    );
  });
  if (!refreshed) {
    throw new Error(`ZotLit in ${vaultId} did not open the Fixture database`);
  }
}

async function setFixtureWriteAuthorization(
  vaultId: string,
  grant: boolean,
): Promise<void> {
  const stored = JSON.stringify({
    version: 1,
    serverID: FIXTURE_LOCAL_API_SERVER_ID,
    ...(grant ? { key: FIXTURE_LOCAL_API_WRITE_KEY, confirmed: true } : {}),
  });
  const answer = await obEval(
    `{app.secretStorage.setSecret("zotlit-zotero-write-authorization",${JSON.stringify(stored)});"configured"}`,
    vaultId,
  ).catch(rethrowUnreachable);
  if (answer !== "configured") {
    throw new Error(`could not configure Zotero write access in ${vaultId}`);
  }
}

async function readFixtureLink(vaultId: string): Promise<FixtureLinkReport> {
  const raw = await obEval(
    `{const services=app.plugins.plugins.${pluginId}.services;JSON.stringify({profileDir:services.bridge.runSync(services.zoteroPref.current).resolvedProfileDir,databasePath:services.bridge.runSync(services.zoteroPref.current).databasePath,dbState:services.bridge.runSync(services.zoteroReads.current).state})}`,
    vaultId,
  );
  return JSON.parse(raw) as FixtureLinkReport;
}

function removeOffline(abs: string): Promise<string | undefined> {
  return unregisterVaultFile(obsidianUserData(), abs);
}

async function clearVaultStorage(
  vaultId: string,
  host: string,
  { keyPrefix = "" }: { keyPrefix?: string } = {},
): Promise<void> {
  const prefix = `${vaultId}-${keyPrefix}`;
  const cleared = await obEval(
    `(async function(){var p=${JSON.stringify(prefix)};` +
      `Object.keys(localStorage).filter(function(k){return k.indexOf(p)===0})` +
      `.forEach(function(k){localStorage.removeItem(k)});` +
      `var databases=await indexedDB.databases();` +
      `await Promise.all(databases.filter(function(d){return d.name&&d.name.indexOf(p)===0}).map(function(d){` +
      `return new Promise(function(resolve,reject){var r=indexedDB.deleteDatabase(d.name);` +
      `r.onsuccess=r.onblocked=function(){resolve()};r.onerror=function(){reject(r.error)}})}));` +
      `return 'ok'})()`,
    host,
  );
  if (cleared !== "ok") {
    throw new Error(`could not clear local storage for vault ${vaultId}`);
  }
}

async function closeVaultWindow(
  id: string,
  closed: () => Promise<boolean>,
): Promise<void> {
  await obEval(
    `(async function(){await app.plugins.disablePlugin(${JSON.stringify(pluginId)});await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve)})});return 'ready'})()`,
    id,
  ).catch(() => undefined);
  await obEval(
    "app.workspace.rootSplit.containerEl.ownerDocument.defaultView.close()",
    id,
  ).catch(() => undefined);
  await waitFor(closed);
}

async function unregisterThrough(
  host: string,
  abs: string,
  id: string,
): Promise<void> {
  await clearVaultStorage(id, host).catch(() => undefined);
  await obEval(
    `localStorage.removeItem('enable-plugin-'+${JSON.stringify(id)});'ok'`,
    host,
  ).catch(() => undefined);

  const removed = await obEval(
    `require('electron').ipcRenderer.sendSync('vault-remove',${JSON.stringify(abs)})`,
    host,
  );
  if (removed !== "true") {
    throw new Error(`vault-remove refused for ${abs} (window still open?)`);
  }
}

async function removeFromLastWindow(abs: string, id: string): Promise<string> {
  await closeVaultWindow(id, async () => {
    const reply = await cli(["eval", "code=app.appId"]).catch(() => undefined);
    return reply !== `=> ${id}`;
  });
  if (!(await isObsidianRunning())) return (await removeOffline(abs)) ?? id;

  let host: string;
  try {
    host = await resolveHost(abs);
  } catch (error) {
    throw new Error(
      `Obsidian has no vault other than ${abs} to host its removal, so the vault stays registered. Quit Obsidian, then run:\n  node packages/scripts/scripts/obsidian-vault.ts remove ${abs}`,
      { cause: error },
    );
  }
  await unregisterThrough(host, abs, id);
  return id;
}

async function removeOnline(abs: string): Promise<string | undefined> {
  let host = await resolveRemovalHost(abs);
  const id = findVaultId(await vaultList(host), abs);
  if (!id) return undefined;

  if (id === host) {
    const other = await resolveRemovalHost(abs, id);
    if (other === undefined) return removeFromLastWindow(abs, id);
    host = other;
  }

  if ((await vaultList(host))[id]?.open) {
    await closeVaultWindow(id, async () => !(await vaultList(host))[id]?.open);
  }
  await unregisterThrough(host, abs, id);
  return id;
}

async function remove(vaultPath: string, purge: boolean): Promise<void> {
  const abs = resolve(vaultPath);

  const running = await isObsidianRunning();
  let id: string | undefined;
  let failure: unknown;
  try {
    id = running ? await removeOnline(abs) : await removeOffline(abs);
  } catch (error) {
    failure = error;
  }

  if (id) {
    console.error(`removed vault ${id}${running ? "" : " (Obsidian closed)"}`);
  } else if (!failure) {
    console.error(`not registered: ${abs}`);
  }

  if (purge) await purgeVault(abs);
  if (failure)
    throw failure instanceof Error
      ? failure
      : new Error("Vault command failed", { cause: failure });
}

const vaultPathPosition = {
  describe: `vault path (default: ${defaultVault})`,
  type: "string",
} as const;

const syncPurgeOption = {
  describe:
    "delete the Development Vault folder, the plugin's vault-scoped local storage, and its stored excerpt images before restoring the complete generated seed",
  type: "boolean",
  default: false,
} as const;

const removePurgeOption = {
  describe: "delete the Development Vault folder after unregistering it",
  type: "boolean",
  default: false,
} as const;

const liveUpdatePortOption = {
  describe:
    "TCP port for the generated seed's Live Updates channel, shared by the vault and the Companion",
  type: "number",
} as const;

const zoteroHttpPortOption = {
  describe: "TCP port for the generated Zotero profile's HTTP server",
  type: "number",
} as const;

const localApiOption = {
  describe:
    "open Zotero's Local API in the generated profile, on the Zotero HTTP port",
  type: "boolean",
  default: false,
} as const;

const grantLocalApiWritesOption = {
  describe:
    "seed a remembered Local API write grant; use --no-grant-local-api-writes to test authorization",
  type: "boolean",
  default: true,
} as const;

const upgraderFieldsOption = {
  describe:
    "JSON file whose Managed Frontmatter fields replace the upgrader case's list: a field array, or a ZotLit data.json; needs --vault-case upgrader",
  type: "string",
} as const;

async function readUpgraderFields(
  path: string | undefined,
  vaultCase: string | undefined,
): Promise<FrontmatterField[] | undefined> {
  if (path === undefined) return undefined;
  if (vaultCase !== "upgrader") {
    throw new Error("--upgrader-fields needs --vault-case upgrader");
  }
  const json: unknown = JSON.parse(await readFile(resolve(path), "utf-8"));
  return v.parse(
    v.array(frontmatterFieldSchema),
    Array.isArray(json)
      ? json
      : (json as Record<string, unknown>)["note.frontmatter-fields"],
  );
}

const scopeCaseOption = {
  describe: "Scope Case to build",
  type: "string",
  choices: SCOPE_CASES.map(({ id }) => id),
  default: DEFAULT_SCOPE_CASE,
} as const;

const vaultCaseOption = {
  describe: `Vault Case to build; each case other than the default uses its own Development Vault folder (default: $${DEV_VAULT_CASE_ENV})`,
  type: "string",
  choices: VAULT_CASES.map(({ id }) => id),
  default: process.env[DEV_VAULT_CASE_ENV],
} as const;

const hostReadinessReference = `Host readiness:
  Host-dependent commands require a Host Vault that answers each CLI probe
  within ${OBSIDIAN_HOST_TIMEOUT_MS / 1_000} seconds. The complete check can take longer.
  Run 'obsidian-vault.ts check' before changing the Fixture.
  Set ZT_HOST_VAULT=<vault-id-or-folder-name> to select the host directly.
  An unset or empty value uses the focused window. Explicit selection errors stop.
  An exact registered ID takes priority; a folder name must be unique across
  all registered vaults, including closed vaults. Use an ID for duplicate names.
  If another folder name matches that ID, ignoring case, select another Host Vault
  or remove the conflicting registration. The selected path must exist and be recorded open.
  Saved open state can be stale; Obsidian can still open a closed window.
  With an unset value and Obsidian running with no vault window open, the check
  opens a registered vault as the host and waits up to ${OBSIDIAN_VAULT_OPEN_TIMEOUT_MS / 1_000} seconds for its window:
  the sandbox vault ('${sandboxFolder}' in Obsidian's user data) if registered,
  else the most recently opened vault whose folder exists.
  On failure, check lists existing registered paths and missing stale paths.
  Open a host vault in Obsidian, then rerun the reported command.`;

const reference = `The open, create, and sync commands rebuild the Fixture Vault first. Run the
Obsidian dev build before them so its bundle is available to copy into the
generated seed. Open and sync keep extra Development Vault files unless
--purge is set. Remove keeps the folder unless --purge is set.

Environment:
  ${OBSIDIAN_HOST_VAULT_ENV}  verified open vault name or id whose window hosts eval calls
  ${DEV_VAULT_CASE_ENV}  Vault Case that --vault-case defaults to; the dev build copies into its vault

${hostReadinessReference}`;

let desktopSlot: DesktopSlot | undefined;
const vaultCli = yargs(hideBin(process.argv))
  .scriptName("obsidian-vault.ts")
  .option("fixture-root", {
    describe: `Fixture to build and link, instead of this worktree's own (default: ${getFixtureRoot(workspaceRoot)})`,
    type: "string",
    global: true,
  })
  .option("inactive", {
    describe:
      "On the host, open vault windows behind the app that has OS focus",
    type: "boolean",
    global: true,
  })
  .middleware(async (argv) => {
    if (!process.env.ZOTLIT_RUN_CONTAINER) {
      desktopSlot = await acquireDesktopSlotOrExit({
        cwd: workspaceRoot,
        command: `obsidian-vault ${String(argv._[0])}`,
        manual: true,
      });
    }
    inactive = argv.inactive === true;
    if (argv["fixture-root"] === undefined) return;
    fixtureLayout = getFixtureLayout(resolve(argv["fixture-root"]));
    fixtureVault = fixtureLayout.vaultDir;
  })
  .command(
    "check",
    "verify that a live Obsidian vault can host CLI calls, opening one when no vault window is open",
    (y) => y.epilogue(hostReadinessReference),
    async () => {
      const host = await checkObsidianHost();
      console.log(host.id);
      console.error(`host vault ready at ${host.path}`);
    },
  )
  .command(
    "open [vault-path]",
    "rebuild, synchronize, and open this worktree's Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", syncPurgeOption)
        .option("scope-case", scopeCaseOption)
        .option("vault-case", vaultCaseOption)
        .option("live-update-port", liveUpdatePortOption)
        .option("zotero-http-port", zoteroHttpPortOption)
        .option("local-api", localApiOption)
        .option("grant-local-api-writes", grantLocalApiWritesOption)
        .option("upgrader-fields", upgraderFieldsOption)
        .option("plugins", pluginsOption)
        .option("install", installOption),
    async (argv) => {
      await open(
        argv["vault-path"] ?? getDevVaultDir(workspaceRoot, argv["vault-case"]),
        {
          purge: argv.purge,
          scopeCase: argv["scope-case"],
          vaultCase: argv["vault-case"],
          liveUpdatePort: argv["live-update-port"],
          zoteroHttpPort: argv["zotero-http-port"],
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
          upgraderFields: await readUpgraderFields(
            argv["upgrader-fields"],
            argv["vault-case"],
          ),
          plugins: await resolveVaultPlugins(workspaceRoot, argv.plugins),
          installed: await resolveVaultPlugins(workspaceRoot, argv.install),
        },
      );
    },
  )
  .command(
    "create [vault-path]",
    "seed and register this worktree's Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("plugins", pluginsOption)
        .option("install", installOption),
    async (argv) => {
      await create(argv["vault-path"] ?? defaultVault, {
        plugins: await resolveVaultPlugins(workspaceRoot, argv.plugins),
        installed: await resolveVaultPlugins(workspaceRoot, argv.install),
      });
    },
  )
  .command(
    "sync [vault-path]",
    "rebuild and copy the Fixture Vault over an existing Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", syncPurgeOption)
        .option("vault-case", vaultCaseOption)
        .option("live-update-port", liveUpdatePortOption)
        .option("zotero-http-port", zoteroHttpPortOption)
        .option("local-api", localApiOption)
        .option("grant-local-api-writes", grantLocalApiWritesOption)
        .option("upgrader-fields", upgraderFieldsOption)
        .option("plugins", pluginsOption)
        .option("install", installOption),
    async (argv) => {
      await sync(
        argv["vault-path"] ?? getDevVaultDir(workspaceRoot, argv["vault-case"]),
        {
          purge: argv.purge,
          vaultCase: argv["vault-case"],
          liveUpdatePort: argv["live-update-port"],
          zoteroHttpPort: argv["zotero-http-port"],
          localApi: argv["local-api"],
          grantLocalApiWrites: argv["grant-local-api-writes"],
          upgraderFields: await readUpgraderFields(
            argv["upgrader-fields"],
            argv["vault-case"],
          ),
          plugins: await resolveVaultPlugins(workspaceRoot, argv.plugins),
          installed: await resolveVaultPlugins(workspaceRoot, argv.install),
        },
      );
    },
  )
  .command(
    "remove [vault-path]",
    "unregister this worktree's Development Vault",
    (y) =>
      y
        .positional("vault-path", vaultPathPosition)
        .option("purge", removePurgeOption),
    async (argv) => {
      await remove(argv["vault-path"] ?? defaultVault, argv.purge);
    },
  )
  .command(
    "list",
    "list known vaults",
    () => {},
    async () => {
      console.log(
        await cli([`vault=${await resolveHost()}`, "vaults", "verbose"]),
      );
    },
  )
  .command(
    "status",
    "print the live Obsidian host vault ID and base path, opening a host vault when no vault window is open",
    () => {},
    async () => {
      const host = await checkObsidianHost();
      console.log(`ready ${host.id} ${host.path}`);
    },
  )
  .command(
    "id [vault-path]",
    "print the registered id for a vault path",
    (y) => y.positional("vault-path", vaultPathPosition),
    async (argv) => {
      const host = await resolveHost();
      const target = argv["vault-path"] ?? defaultVault;
      console.log(findVaultId(await vaultList(host), resolve(target)) ?? "");
    },
  )
  .epilogue(reference)
  .demandCommand(1, 1)
  .strict()
  .version(false)
  .fail((message, error) => {
    console.error(
      `obsidian-vault: ${error instanceof Error ? error.message : (message ?? String(error))}`,
    );
    process.exitCode = 1;
    throw error instanceof Error ? error : new Error(String(message));
  });

try {
  await vaultCli.parseAsync();
} catch {
  // The fail handler reported the error and set the exit code.
} finally {
  desktopSlot?.release();
}
