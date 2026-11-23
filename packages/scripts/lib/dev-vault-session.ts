import { isAbsolute, relative, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { FIXTURE_PLUGIN_ID } from "./fixture/layout.ts";
import { isObsidianUnreachable } from "./obsidian-cli.ts";
import type { VaultEntry } from "./obsidian-vault-registry.ts";
import { findVaultId } from "./obsidian-vault-registry.ts";
import type { VaultPlugin } from "./vault-plugins.ts";

export const ZOTERO_PATHS_KEY = "zotlit-zotero-paths";

export type ObsidianCall = (args: string[]) => Promise<string>;

export interface VaultSession {
  readonly call: ObsidianCall;
  readonly evaluate: (code: string, target?: string) => Promise<string>;
  readonly waitFor: (
    check: () => Promise<boolean>,
    tries?: number,
  ) => Promise<boolean>;
  readonly vaultList: (host?: string) => Promise<Record<string, VaultEntry>>;
  readonly pause: () => Promise<void>;
}

export function rethrowUnreachable(error: unknown): undefined {
  if (isObsidianUnreachable(error)) throw error;
  return undefined;
}

export function createVaultSession(
  call: ObsidianCall,
  { pollMs = 250 }: { pollMs?: number } = {},
): VaultSession {
  const pause = async () => {
    await delay(pollMs);
  };
  const evaluate = async (code: string, target?: string) => {
    const text = await call([
      ...(target ? [`vault=${target}`] : []),
      "eval",
      `code=${code}`,
    ]);
    if (text === "") return "";
    if (!text.startsWith("=> ")) {
      throw new Error(`obsidian eval failed: ${text}`);
    }
    return text.slice(3);
  };
  return {
    call,
    evaluate,
    pause,
    waitFor: async (check, tries = 40) => {
      for (let attempt = 0; attempt < tries; attempt++) {
        if (await check()) return true;
        await pause();
      }
      return false;
    },
    vaultList: async (host) => {
      const raw = await evaluate(
        `require('electron').ipcRenderer.sendSync('vault-list')`,
        host,
      );
      return JSON.parse(raw) as Record<string, VaultEntry>;
    },
  };
}

export interface FixturePaths {
  readonly profileDir: string;
  readonly dataDir: string;
}

export async function seedFixturePaths(
  session: VaultSession,
  {
    host,
    vaultId,
    fixture,
  }: { host: string; vaultId: string; fixture: FixturePaths },
): Promise<void> {
  const key = JSON.stringify(`${vaultId}-${ZOTERO_PATHS_KEY}`);
  const value = JSON.stringify({
    profileDir: fixture.profileDir,
    dataDir: fixture.dataDir,
  });
  const stored = await session.evaluate(
    `(()=>{localStorage.setItem(${key},${JSON.stringify(value)});return localStorage.getItem(${key})})()`,
    host,
  );
  if (stored !== value) {
    throw new Error(
      `could not store the Fixture paths for vault ${vaultId}: ${stored}`,
    );
  }
}

interface PluginStart {
  host: string;
  vaultId: string;
  plugins: readonly Pick<VaultPlugin, "id" | "app">[];
  fixture?: FixturePaths;
  retry: string;
}

function buildCommands(plugins: PluginStart["plugins"]): string {
  return plugins
    .map((plugin) => `'pnpm --filter ./${plugin.app} build:dev'`)
    .join(" and ");
}

export async function trustVault(
  session: VaultSession,
  { host, vaultId: id, plugins, fixture, retry }: PluginStart,
): Promise<void> {
  const { call, evaluate, waitFor } = session;
  if (fixture) await seedFixturePaths(session, { host, vaultId: id, fixture });
  const answered = await waitFor(async () => {
    const state = await call([`vault=${id}`, "plugins:restrict"]);
    return state === "on" || state === "off";
  });
  if (!answered) {
    throw new Error(`vault ${id} opened but never answered plugins:restrict`);
  }

  const trustedPage = await evaluate("String(performance.timeOrigin)", id);
  const trusted = await call([`vault=${id}`, "plugins:restrict", "off"]);
  if (!/disabled|^off$/i.test(trusted)) {
    throw new Error(`could not leave Restricted Mode in ${id}: ${trusted}`);
  }
  const reloads = /reloading/i.test(trusted);

  let reloaded = !reloads;
  const ids = JSON.stringify(plugins.map((plugin) => plugin.id));
  const loaded = await waitFor(async () => {
    const answer = await evaluate(
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
      `${plugins.map((plugin) => plugin.id).join(", ")} did not load in ${id}. Run ${buildCommands(plugins)}, then run '${retry}'.`,
    );
  }
}

export async function openRegisteredVault(
  session: VaultSession,
  {
    host,
    vaultId: registered,
    plugins,
    fixture,
    retry,
    openCode,
    sync,
  }: PluginStart & { openCode: string; sync: () => Promise<void> },
): Promise<void> {
  const { call, evaluate, waitFor, vaultList, pause } = session;
  if (fixture) {
    await seedFixturePaths(session, { host, vaultId: registered, fixture });
  }
  await sync();
  const opened =
    (await vaultList(host))[registered]?.open === true
      ? undefined
      : await evaluate(openCode, host);
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

  const manifests = await evaluate(
    "(async()=>{await app.plugins.loadManifests();return 'loaded'})()",
    registered,
  );
  if (manifests !== "loaded") {
    throw new Error(
      `could not read the plugin manifests in ${registered}: ${manifests}`,
    );
  }

  for (const { id, app } of plugins) {
    const recovery = `Run ${buildCommands([{ id, app }])}, then run '${retry}'.`;
    let reloaded = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      reloaded = await call([
        `vault=${registered}`,
        "plugin:reload",
        `id=${id}`,
      ]);
      if (reloaded.toLowerCase().startsWith("reloaded:")) break;
      await pause();
    }
    if (!reloaded.toLowerCase().startsWith("reloaded:")) {
      throw new Error(
        `could not reload ${id} in ${registered}: ${reloaded}. ${recovery}`,
      );
    }

    const loaded = await waitFor(async () => {
      const answer = await evaluate(
        `String(${JSON.stringify(id)} in app.plugins.plugins)`,
        registered,
      ).catch(rethrowUnreachable);
      return answer === "true";
    });
    if (!loaded) {
      throw new Error(`${id} did not load in ${registered}. ${recovery}`);
    }
  }
}

function inside(root: string, path: unknown): boolean {
  if (typeof path !== "string") return false;
  const rest = relative(root, path);
  return !isAbsolute(rest) && rest.split(sep)[0] !== "..";
}

export async function checkFixtureLink(
  session: VaultSession,
  {
    host,
    vaultPath,
    fixtureRoot,
  }: { host: string; vaultPath: string; fixtureRoot: string },
): Promise<string | undefined> {
  const vaults = await session.vaultList(host);
  const id = findVaultId(vaults, vaultPath);
  if (!id || vaults[id]?.open !== true) return undefined;

  const raw = await session.evaluate(
    `{const plugin=app.plugins.plugins[${JSON.stringify(FIXTURE_PLUGIN_ID)}];plugin?JSON.stringify({profileDir:plugin.services.bridge.runSync(plugin.services.zoteroPref.current).resolvedProfileDir,databasePath:plugin.services.bridge.runSync(plugin.services.zoteroPref.current).databasePath}):"absent"}`,
    id,
  );
  if (raw === "absent") return undefined;
  const { profileDir, databasePath } = JSON.parse(raw) as {
    profileDir?: unknown;
    databasePath?: unknown;
  };
  if (inside(fixtureRoot, profileDir) && inside(fixtureRoot, databasePath)) {
    return id;
  }
  throw new Error(
    `ZotLit in the Development Vault ${id} reads Zotero outside the Fixture at ${fixtureRoot}:\n  profile: ${String(profileDir)}\n  database: ${String(databasePath)}\nRun 'node packages/scripts/scripts/obsidian-vault.ts open ${vaultPath}' to link the Fixture again.`,
  );
}
