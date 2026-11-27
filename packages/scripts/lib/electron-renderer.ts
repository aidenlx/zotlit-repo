import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { PluginOption } from "vite";
import { build } from "vite";

import { getPackageRoot, getWorkspaceRoot } from "./package-roots.ts";

export const testElectron = process.env.ZOTLIT_TEST_ELECTRON_PATH;

export async function runInElectron(options: {
  entry: string;
  name: string;
  marker: string;
  timeoutMs?: number;
  minimized?: boolean;
  plugins?: PluginOption[];
  alias?: Record<string, string>;
  define?: Record<string, string>;
}): Promise<unknown> {
  const workspaceRoot = await getWorkspaceRoot(options.entry);
  const parent = resolve(workspaceRoot, ".scratch");
  await mkdir(parent, { recursive: true });
  await using resources = new AsyncDisposableStack();
  const folder = resources.adopt(
    await mkdtemp(resolve(parent, `${options.name}-`)),
    (path) => rm(path, { recursive: true, force: true }),
  );
  const output = await build({
    configFile: false,
    plugins: options.plugins,
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      ...options.define,
    },
    resolve: {
      alias: {
        "@": resolve(getPackageRoot(options.entry), "src"),
        ...options.alias,
      },
    },
    build: {
      write: false,
      lib: { entry: options.entry, name: options.name, formats: ["iife"] },
    },
  });
  const result = Array.isArray(output) ? output[0]! : output;
  if (!("output" in result)) throw new Error("Expected a bundled entry");
  const chunk = result.output.find((part) => part.type === "chunk");
  if (!chunk) throw new Error("Missing entry bundle");
  const script = resolve(folder, "main.cjs");
  const minimize = options.minimized
    ? `
    window.show();
    window.minimize();
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await window.webContents.executeJavaScript("document.visibilityState")) === "hidden") break;
      const { promise, resolve } = Promise.withResolvers();
      setTimeout(resolve, 100);
      await promise;
    }`
    : "";
  await writeFile(
    script,
    `
const { app, BrowserWindow } = require("electron");
app.dock?.hide();
app.setPath("userData", ${JSON.stringify(resolve(folder, "profile"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false${options.minimized ? ",\n    x: -10000,\n    y: -10000" : ""}
  });
  try {
    await window.loadFile(${JSON.stringify(resolve(folder, "index.html"))});
    ${minimize}
    const result = await window.webContents.executeJavaScript(${JSON.stringify(`${chunk.code}\n${options.name}.run()`)});
    process.stdout.write(${JSON.stringify(`${options.marker}=`)} + JSON.stringify(result) + "\\n");
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
`,
  );
  await writeFile(
    resolve(folder, "index.html"),
    `<!doctype html><title>${options.name}</title>`,
  );
  const { stdout } = await promisify(execFile)(testElectron!, [script], {
    timeout: options.timeoutMs ?? 30_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" },
  });
  const line = stdout
    .split("\n")
    .find((value) => value.startsWith(`${options.marker}=`));
  if (!line) throw new Error(`Missing ${options.marker} in Electron output`);
  return JSON.parse(line.slice(options.marker.length + 1));
}
