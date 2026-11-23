import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  checkFixtureLink,
  createVaultSession,
  openRegisteredVault,
  trustVault,
  ZOTERO_PATHS_KEY,
} from "./dev-vault-session.ts";
import type { FixturePaths } from "./dev-vault-session.ts";

const FIXTURE_ROOT = "/work/.scratch/acceptance-fixture";
const FIXTURE: FixturePaths = {
  profileDir: join(FIXTURE_ROOT, "zotero-profile"),
  dataDir: join(FIXTURE_ROOT, "zotero-data"),
};
const PERSONAL: FixturePaths = {
  profileDir:
    "/Users/researcher/Library/Application Support/Zotero/Profiles/abc.default",
  dataDir: "/Users/researcher/Zotero",
};
const PLUGINS = [
  { id: "zotlit-reader", app: "apps/reader" },
  { id: "zotlit", app: "apps/obsidian" },
];
const HOST = "host-id";
const DEV = "dev-id";
const DEV_PATH = "/work/tests/fixture-vault-work";
const RETRY = "node packages/scripts/scripts/obsidian-vault.ts open";

interface VaultSpec {
  path: string;
  open: boolean;
  restricted?: boolean;
  enabled?: readonly string[];
  onDisk?: string[];
  failing?: string[];
}

interface FakeWindow {
  app: {
    appId: string;
    plugins: {
      plugins: Record<string, unknown>;
      manifests: Record<string, { id: string }>;
      loadManifests: () => Promise<void>;
    };
  };
  timeOrigin: number;
}

function fakeObsidian(specs: Record<string, VaultSpec>) {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
  };
  const zotlitRead: unknown[] = [];
  const windows = new Map<string, FakeWindow>();
  let pages = 0;

  function readPaths(id: string): unknown {
    const raw = storage.get(`${id}-${ZOTERO_PATHS_KEY}`);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }

  function load(id: string, plugin: string): boolean {
    const spec = specs[id]!;
    const window = windows.get(id)!;
    if (spec.failing?.includes(plugin)) return false;
    if (plugin !== "zotlit") {
      window.app.plugins.plugins[plugin] = {};
      return true;
    }
    const paths = readPaths(id) as FixturePaths | null;
    zotlitRead.push(paths);
    const dataDir = paths?.dataDir ?? PERSONAL.dataDir;
    const current = {
      resolvedProfileDir: paths?.profileDir ?? PERSONAL.profileDir,
      databasePath: join(dataDir, "zotero.sqlite"),
    };
    window.app.plugins.plugins[plugin] = {
      services: {
        bridge: { runSync: (value: unknown) => value },
        zoteroPref: { current },
      },
    };
    return true;
  }

  function start(id: string): void {
    const spec = specs[id]!;
    const installed = () =>
      Object.fromEntries(
        (spec.onDisk ?? PLUGINS.map(({ id: plugin }) => plugin)).map(
          (plugin) => [plugin, { id: plugin }],
        ),
      );
    const plugins = {
      plugins: {},
      manifests: installed(),
      loadManifests: async () => {
        plugins.manifests = installed();
      },
    };
    windows.set(id, { app: { appId: id, plugins }, timeOrigin: ++pages });
    spec.open = true;
    if (spec.restricted) return;
    for (const plugin of spec.enabled ?? PLUGINS.map(({ id }) => id)) {
      load(id, plugin);
    }
  }

  for (const [id, spec] of Object.entries(specs)) if (spec.open) start(id);

  const electron = {
    ipcRenderer: {
      sendSync: (channel: string, path?: string) => {
        if (channel === "vault-list") {
          return Object.fromEntries(
            Object.entries(specs).map(([id, spec]) => [
              id,
              { path: spec.path, ts: 1, open: spec.open },
            ]),
          );
        }
        const id = Object.keys(specs).find(
          (each) => specs[each]!.path === path,
        );
        if (channel !== "vault-open" || !id) return false;
        start(id);
        return true;
      },
    },
  };

  async function evaluate(target: string, code: string): Promise<string> {
    const window = windows.get(target)!;
    const context = createContext({
      app: window.app,
      localStorage,
      performance: { timeOrigin: window.timeOrigin },
      require: () => electron,
    });
    const value: unknown = await runInContext(code, context);
    return `=> ${typeof value === "string" ? value : JSON.stringify(value)}`;
  }

  const call = async (args: string[]): Promise<string> => {
    const target = args[0]!.startsWith("vault=")
      ? args.shift()!.slice("vault=".length)
      : HOST;
    const [command, ...rest] = args;
    if (!windows.has(target)) return "Vault not found.";
    if (command === "eval") {
      return await evaluate(target, rest[0]!.slice("code=".length));
    }
    const spec = specs[target]!;
    if (command === "plugins:restrict") {
      if (rest[0] !== "off") return spec.restricted ? "on" : "off";
      spec.restricted = false;
      start(target);
      return "Restricted mode disabled. Reloading the window.";
    }
    if (command === "plugin:reload") {
      const plugin = rest[0]!.slice("id=".length);
      if (!(plugin in windows.get(target)!.app.plugins.manifests)) {
        return `Error: plugin ${plugin} is not installed.`;
      }
      return load(target, plugin)
        ? `Reloaded: ${plugin}`
        : `Error: plugin ${plugin} failed to load`;
    }
    return `Error: unknown command ${command}`;
  };

  return {
    session: createVaultSession(call, { pollMs: 0 }),
    storedPaths: () => readPaths(DEV),
    zotlitRead,
    manifests: (id: string) =>
      Object.keys(windows.get(id)!.app.plugins.manifests),
  };
}

function vaults(dev: Omit<VaultSpec, "path">): Record<string, VaultSpec> {
  return {
    [HOST]: { path: "/vaults/host", open: true, enabled: [] },
    [DEV]: { path: DEV_PATH, ...dev },
  };
}

const start = { host: HOST, vaultId: DEV, fixture: FIXTURE, retry: RETRY };

describe("a new Development Vault leaving Restricted Mode", () => {
  it("gives ZotLit the Fixture paths at its first start", async () => {
    const obsidian = fakeObsidian(vaults({ open: true, restricted: true }));

    await trustVault(obsidian.session, { ...start, plugins: PLUGINS });

    expect(obsidian.zotlitRead).toEqual([FIXTURE]);
  });

  it("keeps the Fixture paths and names the open command when a plugin does not load", async () => {
    const obsidian = fakeObsidian(
      vaults({ open: true, restricted: true, failing: ["zotlit-reader"] }),
    );

    await expect(
      trustVault(obsidian.session, { ...start, plugins: PLUGINS }),
    ).rejects.toThrow(
      `did not load in ${DEV}. Run 'pnpm --filter ./apps/reader build:dev' and 'pnpm --filter ./apps/obsidian build:dev', then run '${RETRY}'.`,
    );
    expect(obsidian.storedPaths()).toEqual(FIXTURE);
  });
});

describe("a registered Development Vault opened again", () => {
  const sync = async () => {};

  it("gives ZotLit the Fixture paths when its window opens and at each reload", async () => {
    const obsidian = fakeObsidian(vaults({ open: false }));

    await openRegisteredVault(obsidian.session, {
      ...start,
      plugins: PLUGINS,
      openCode: `require('electron').ipcRenderer.sendSync('vault-open',${JSON.stringify(DEV_PATH)},false)`,
      sync,
    });

    expect(obsidian.zotlitRead).toEqual([FIXTURE, FIXTURE]);
  });

  it("keeps the Fixture paths and names the open command when a plugin does not reload", async () => {
    const obsidian = fakeObsidian(
      vaults({ open: true, failing: ["zotlit-reader"] }),
    );

    await expect(
      openRegisteredVault(obsidian.session, {
        ...start,
        plugins: PLUGINS,
        openCode: "false",
        sync,
      }),
    ).rejects.toThrow(
      `could not reload zotlit-reader in ${DEV}: Error: plugin zotlit-reader failed to load. Run 'pnpm --filter ./apps/reader build:dev', then run '${RETRY}'.`,
    );
    expect(obsidian.storedPaths()).toEqual(FIXTURE);
  });
});

describe("the Development Vault check", () => {
  const check = { host: HOST, vaultPath: DEV_PATH, fixtureRoot: FIXTURE_ROOT };

  it("fails while ZotLit reads a Zotero profile outside the Fixture", async () => {
    const obsidian = fakeObsidian(vaults({ open: true }));

    await expect(checkFixtureLink(obsidian.session, check)).rejects.toThrow(
      `ZotLit in the Development Vault ${DEV} reads Zotero outside the Fixture at ${FIXTURE_ROOT}:\n  profile: ${PERSONAL.profileDir}\n  database: ${join(PERSONAL.dataDir, "zotero.sqlite")}`,
    );
  });

  it("passes while ZotLit reads the Fixture", async () => {
    const obsidian = fakeObsidian(vaults({ open: false }));
    await openRegisteredVault(obsidian.session, {
      ...start,
      plugins: PLUGINS,
      openCode: `require('electron').ipcRenderer.sendSync('vault-open',${JSON.stringify(DEV_PATH)},false)`,
      sync: async () => {},
    });

    await expect(checkFixtureLink(obsidian.session, check)).resolves.toBe(DEV);
  });

  it("passes when no Development Vault is registered", async () => {
    const obsidian = fakeObsidian({
      [HOST]: { path: "/vaults/host", open: true, enabled: [] },
    });

    await expect(
      checkFixtureLink(obsidian.session, check),
    ).resolves.toBeUndefined();
  });
});
