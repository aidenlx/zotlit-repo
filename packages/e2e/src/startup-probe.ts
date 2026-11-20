export interface LayoutCallbackTimes {
  start: number;
  syncEnd?: number;
  end?: number;
}

export interface StartupPageTimes {
  layoutReady?: number;
  callbacksDone?: number;
  snapshotShown: boolean;
  snapshotGone?: number;
  clockSync?: number;
  marks: Record<string, number>;
  layoutCallbacks: LayoutCallbackTimes[];
}

export interface ProbeConfig {
  readonly role: "gate" | "probe";
  readonly resultDir: string;
  readonly settleMs: number;
  readonly samplingIntervalUs: number;
  readonly report: string;
}

export interface ProbeResult {
  readonly timeOrigin: number;
  readonly devStartup: string;
  readonly times: StartupPageTimes;
  readonly report?: unknown;
  readonly profile?: string;
}

interface Workspace {
  on(name: string, callback: () => void): unknown;
  layoutReadyCallbacksDone?: Promise<unknown>;
  onLayoutReady(callback: () => unknown): void;
}

interface ProbeApp {
  workspace: Workspace;
}

type PluginScript = (script: unknown, fn: ModuleFunction) => unknown;
type ModuleFunction = (
  require: unknown,
  module: { exports: Record<string, unknown> },
  exports: unknown,
) => unknown;

interface InspectorSession {
  connect(): void;
  post(
    method: string,
    params: Record<string, unknown>,
    callback: (error: Error | null, result: Record<string, unknown>) => void,
  ): void;
}

interface ProbeState {
  times: StartupPageTimes;
  session?: InspectorSession;
}

type NodeRequire = (id: string) => unknown;

export function startupProbePlugin(
  config: ProbeConfig,
  PluginBase: new (...args: unknown[]) => { app: ProbeApp },
  nodeRequire: NodeRequire,
): unknown {
  const scope = window as unknown as Record<string, unknown>;
  const now = (): number => performance.now();
  const fs = nodeRequire("node:fs") as typeof import("node:fs");
  const path = nodeRequire("node:path") as typeof import("node:path");

  const state = (scope.__ztStartup ??= {
    times: { snapshotShown: false, marks: {}, layoutCallbacks: [] },
  }) as ProbeState;
  const { times } = state;
  const mark = (name: string): void => {
    times.marks[name] ??= now();
  };

  const post = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      state.session!.post(method, params, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });

  function __ztClockSync(): number {
    const start = now();
    times.clockSync = start;
    let spins = 0;
    while (now() - start < 2) spins++;
    return spins;
  }

  const watchLayoutCallbacks = (workspace: Workspace): void => {
    const original = workspace.onLayoutReady.bind(workspace);
    workspace.onLayoutReady = (callback) => {
      original(() => {
        const entry: LayoutCallbackTimes = { start: now() };
        times.layoutCallbacks.push(entry);
        let result: unknown;
        try {
          result = callback();
        } finally {
          entry.syncEnd = now();
        }
        if (result instanceof Promise) {
          const done = (): void => {
            entry.end = now();
          };
          result.then(done, done);
        } else {
          entry.end = entry.syncEnd;
        }
        return result;
      });
    };
  };

  const watchPluginClass = (pluginClass: unknown): void => {
    if (typeof pluginClass !== "function") return;
    const prototype = pluginClass.prototype as Record<string, unknown>;
    const onload = prototype.onload as (...args: unknown[]) => unknown;
    prototype.onload = function (this: { app: ProbeApp }, ...args: unknown[]) {
      mark("onload:start");
      watchLayoutCallbacks(this.app.workspace);
      const result = onload.apply(this, args);
      const done = (): void => mark("onload:end");
      void Promise.resolve(result).then(done, done);
      return result;
    };
    const loadCSS = prototype.loadCSS as (
      ...args: unknown[]
    ) => Promise<unknown>;
    prototype.loadCSS = async function (...args: unknown[]) {
      mark("css:start");
      try {
        return await loadCSS.apply(this, args);
      } finally {
        mark("css:end");
      }
    };
  };

  const gate = async (): Promise<void> => {
    const { Session } = nodeRequire("node:inspector") as {
      Session: new () => InspectorSession;
    };
    state.session = new Session();
    state.session.connect();
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", {
      interval: config.samplingIntervalUs,
    });
    await post("Profiler.start");
    __ztClockSync();
    const pluginScript = scope.__obsidianPluginScript as PluginScript;
    scope.__obsidianPluginScript = ((script, fn) =>
      pluginScript(script, (require, module, exports) => {
        mark("eval:start");
        const result = fn(require, module, exports);
        mark("eval:end");
        watchPluginClass(module.exports.default ?? module.exports);
        return result;
      })) satisfies PluginScript;
  };

  const settled = (workspace: Workspace): Promise<void> =>
    new Promise((resolve) => {
      let snapshotDone = false;
      let callbacksDone = false;
      const check = (): void => {
        if (snapshotDone && callbacksDone) resolve();
      };
      workspace.on("layout-ready", () => {
        times.layoutReady = now();
        const snapshot = document.getElementById("startup-snapshot");
        times.snapshotShown = snapshot !== null;
        if (snapshot?.parentNode) {
          new MutationObserver((_, observer) => {
            if (snapshot.isConnected) return;
            times.snapshotGone = now();
            observer.disconnect();
            snapshotDone = true;
            check();
          }).observe(snapshot.parentNode, { childList: true });
        } else {
          snapshotDone = true;
        }
        queueMicrotask(() => {
          void Promise.resolve(workspace.layoutReadyCallbacksDone).then(() => {
            times.callbacksDone = now();
            callbacksDone = true;
            check();
          });
        });
      });
    });

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));

  const devStartup = async (): Promise<string> => {
    const handleCli = scope.handleCli as (argv: string[]) => Promise<string>;
    for (;;) {
      const reply = await handleCli(["dev:startup", "format=json"]);
      if ((JSON.parse(reply) as { total: number }).total > 0) return reply;
      await sleep(200);
    }
  };

  const write = (name: string, data: string): void => {
    const target = path.join(config.resultDir, name);
    fs.writeFileSync(`${target}.tmp`, data);
    fs.renameSync(`${target}.tmp`, target);
  };

  const finish = async (workspace: Workspace): Promise<void> => {
    await settled(workspace);
    const startup = await devStartup();
    await sleep(config.settleMs);
    let profile: string | undefined;
    if (state.session) {
      const { profile: recorded } = await post("Profiler.stop");
      profile = `profile-${performance.timeOrigin}.cpuprofile`;
      write(profile, JSON.stringify(recorded));
    }
    const report = config.report ? await (0, eval)(config.report) : undefined;
    const result: ProbeResult = {
      timeOrigin: performance.timeOrigin,
      devStartup: startup,
      times,
      report,
      profile,
    };
    write(`result-${performance.timeOrigin}.json`, JSON.stringify(result));
    const next = path.join(config.resultDir, "next");
    for (;;) {
      const action = fs.existsSync(next)
        ? fs.readFileSync(next, "utf8").trim()
        : "";
      if (action) {
        fs.rmSync(next, { force: true });
        if (action === "reload") location.reload();
        else
          (
            nodeRequire("@electron/remote") as { app: { quit(): void } }
          ).app.quit();
        return;
      }
      await sleep(100);
    }
  };

  return class StartupProbe extends PluginBase {
    async onload(): Promise<void> {
      if (config.role === "gate") {
        await gate();
        return;
      }
      void finish(this.app.workspace);
    }
  };
}

export function probePluginFiles(config: ProbeConfig): {
  id: string;
  manifest: string;
  mainJs: string;
} {
  const id = `zotlit-startup-${config.role}`;
  return {
    id,
    manifest: JSON.stringify({
      id,
      name: `ZotLit start-up ${config.role}`,
      version: "1.0.0",
      minAppVersion: "1.15.0",
      description: "Measures the start-up of the plugin before it.",
      author: "ZotLit",
      isDesktopOnly: true,
    }),
    mainJs: `module.exports = (${startupProbePlugin.toString()})(${JSON.stringify(config)}, require("obsidian").Plugin, require);\n`,
  };
}
