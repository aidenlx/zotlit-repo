import {
  mkdir,
  mkdtempDisposable,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkRoot, checkZone } from "./runtime-check.ts";

interface Pkg {
  readonly layer?: string;
  readonly layers?: Record<string, string>;
  readonly dependencies?: readonly string[];
  readonly files: Record<string, string>;
}

interface Workspace extends AsyncDisposable {
  readonly root: string;
}

async function workspace(packages: Record<string, Pkg>): Promise<Workspace> {
  const temp = await mkdtempDisposable(join(tmpdir(), "zt-runtime-check-"));
  const root = await realpath(temp.path);
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
  await write(
    "node_modules/obsidian/package.json",
    JSON.stringify({ name: "obsidian", types: "obsidian.d.ts" }),
  );
  await write(
    "node_modules/obsidian/obsidian.d.ts",
    "export declare class App {}\n",
  );
  for (const [name, pkg] of Object.entries(packages)) {
    const dir = `packages/${name}`;
    await write(
      `${dir}/package.json`,
      JSON.stringify({
        name: `@ws/${name}`,
        type: "module",
        exports: { "./*": "./src/*" },
        zotlit: { layer: pkg.layer, layers: pkg.layers },
      }),
    );
    for (const [file, content] of Object.entries(pkg.files)) {
      await write(`${dir}/${file}`, content);
    }
    for (const dep of pkg.dependencies ?? []) {
      await mkdir(join(root, dir, "node_modules/@ws"), { recursive: true });
      await symlink(
        join(root, "packages", dep),
        join(root, dir, "node_modules/@ws", dep),
      );
    }
  }
  return { root, [Symbol.asyncDispose]: () => temp.remove() };
}

describe("checkZone", () => {
  it("reports a host-free file that imports obsidian", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts":
            'import { App } from "obsidian";\nexport const app = App;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/view.ts",
        rule: "A host-free file loads in a renderer on each host, where the obsidian module is absent.",
        chain: ["packages/feature/src/core/view.ts", "obsidian"],
      },
    ]);
  });

  it("follows reach through two steps and names the chain", async () => {
    await using ws = await workspace({
      kit: {
        layer: "worker",
        files: {
          "src/view-atoms.ts":
            'import type { App } from "obsidian";\nexport type Host = App;\n',
        },
      },
      feature: {
        dependencies: ["kit"],
        files: {
          "src/core/view.ts": 'import "./middle.ts";\n',
          "src/core/middle.ts":
            'import type { Host } from "@ws/kit/view-atoms.ts";\nexport type H = Host;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations.map(({ chain }) => chain)).toEqual([
      [
        "packages/feature/src/core/middle.ts",
        "packages/kit/src/view-atoms.ts",
        "obsidian",
      ],
    ]);
  });

  it("counts a type-only import as reach", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts":
            'import type { App } from "obsidian";\nexport type A = App;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations.map(({ chain }) => chain)).toEqual([
      ["packages/feature/src/core/view.ts", "obsidian"],
    ]);
  });

  it("counts a module augmentation as reach", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts":
            'declare module "obsidian" {\n  interface App {\n    zotlit: true;\n  }\n}\nexport {};\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/view.ts",
        rule: "A host-free file loads in a renderer on each host, where the obsidian module is absent.",
        chain: ["packages/feature/src/core/view.ts", "obsidian"],
      },
    ]);
  });

  it("reports an augmentation of a workspace module that the zone does not load", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts":
            'declare module "../obsidian/registry.ts" {\n  interface Registry {\n    view: true;\n  }\n}\nexport {};\n',
          "src/obsidian/registry.ts": "export interface Registry {}\n",
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/view.ts",
        rule: 'A module augmentation names "../obsidian/registry.ts", which the host-free zone program does not load, so the check cannot follow it (packages/feature/src/core/view.ts:1).',
        chain: ["packages/feature/src/core/view.ts"],
      },
    ]);
  });

  it("reports Electron that the package cannot resolve", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts": 'import "./bridge.ts";\n',
          "src/core/bridge.ts":
            'import { ipcRenderer } from "electron";\nexport const ipc = ipcRenderer;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/bridge.ts",
        rule: "A host-free file loads in a renderer on each host, where Electron is absent.",
        chain: ["packages/feature/src/core/bridge.ts", "electron"],
      },
    ]);
  });

  it("reports an Obsidian file that reaches @effect/platform-node", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/obsidian/files.ts":
            'import * as Files from "@effect/platform-node/NodeFileSystem";\nexport const files = Files;\n',
          "src/obsidian/layer.ts":
            'import { layer } from "@effect/platform-node";\nexport const node = layer;\n',
          "node_modules/@effect/platform-node/package.json": JSON.stringify({
            name: "@effect/platform-node",
            types: "index.d.ts",
          }),
          "node_modules/@effect/platform-node/index.d.ts":
            "export declare const layer: unknown;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "obsidian");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/obsidian/layer.ts",
        rule: "An Obsidian file loads in Obsidian on Mobile and desktop, where Node is absent.",
        chain: [
          "packages/feature/src/obsidian/layer.ts",
          "@effect/platform-node",
        ],
      },
      {
        file: "packages/feature/src/obsidian/files.ts",
        rule: "An Obsidian file loads in Obsidian on Mobile and desktop, where Node is absent.",
        chain: [
          "packages/feature/src/obsidian/files.ts",
          "@effect/platform-node/NodeFileSystem",
        ],
      },
    ]);
  });

  it("passes a desktop file that imports @effect/platform-node", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/desktop/files.ts":
            'import * as Files from "@effect/platform-node/NodeFileSystem";\nexport const files = Files;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "desktop");
    expect(report).toEqual({ zone: "desktop", files: 1, violations: [] });
  });

  it("reports a host-free file that reaches a file of the Obsidian layer", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.ts": 'export { open } from "../obsidian/open.ts";\n',
          "src/obsidian/open.ts": "export const open = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/view.ts",
        rule: "A host-free file loads in a renderer on each host, where the obsidian module is absent; packages/feature/src/obsidian/open.ts is in the Obsidian zone.",
        chain: [
          "packages/feature/src/core/view.ts",
          "packages/feature/src/obsidian/open.ts",
        ],
      },
    ]);
  });

  it("passes a host-free module whose name contains obsidian", async () => {
    await using ws = await workspace({
      "obsidian-i18n": {
        layer: "host-free",
        files: { "src/obsidian.ts": "export const locale = 'en';\n" },
      },
      feature: {
        dependencies: ["obsidian-i18n"],
        files: {
          "src/core/view.ts":
            'import { locale } from "@ws/obsidian-i18n/obsidian.ts";\nexport const l = locale;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report).toEqual({ zone: "host-free", files: 2, violations: [] });
  });

  it("reads a package zone from its manifest field", async () => {
    await using ws = await workspace({
      kernel: {
        layer: "host-free",
        files: {
          "src/clipboard.ts": 'export * from "../../engine/src/x.ts";\n',
        },
      },
      engine: {
        layer: "worker",
        files: {
          "src/query.ts": 'import "@ws/kernel/clipboard.ts";\n',
          "src/x.ts": "export const x = 1;\n",
        },
        dependencies: ["kernel"],
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report.violations).toEqual([
      {
        file: "packages/engine/src/query.ts",
        rule: "A Worker file loads in a Web Worker on each host, where the DOM is absent; packages/kernel/src/clipboard.ts is in the host-free zone.",
        chain: [
          "packages/engine/src/query.ts",
          "packages/kernel/src/clipboard.ts",
        ],
      },
    ]);
  });

  it("reports a DOM name in the Worker zone", async () => {
    await using ws = await workspace({
      engine: {
        layer: "worker",
        files: { "src/title.ts": "export const title = document.title;\n" },
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report.violations).toEqual([
      {
        file: "packages/engine/src/title.ts",
        rule: "A Worker file loads in a Web Worker on each host, where the DOM is absent: packages/engine/src/title.ts:1 TS2584 Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.",
        chain: ["packages/engine/src/title.ts"],
      },
    ]);
  });

  it("reads the worker layer folder as the Worker zone", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/worker/job.ts":
            'import { plan } from "../core/plan.ts";\nexport const job = plan;\n',
          "src/worker/title.ts": "export const title = document.title;\n",
          "src/core/plan.ts": "export const plan = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report).toEqual({
      zone: "worker",
      files: 2,
      violations: [
        {
          file: "packages/feature/src/worker/job.ts",
          rule: "A Worker file loads in a Web Worker on each host, where the DOM is absent; packages/feature/src/core/plan.ts is in the host-free zone.",
          chain: [
            "packages/feature/src/worker/job.ts",
            "packages/feature/src/core/plan.ts",
          ],
        },
        {
          file: "packages/feature/src/worker/title.ts",
          rule: "A Worker file loads in a Web Worker on each host, where the DOM is absent: packages/feature/src/worker/title.ts:1 TS2584 Cannot find name 'document'. Do you need to change your target library? Try changing the 'lib' compiler option to include 'dom'.",
          chain: ["packages/feature/src/worker/title.ts"],
        },
      ],
    });
  });

  it("leaves test files and test support out of the checked set", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/core/view.test.ts": 'import "obsidian";\n',
          "src/core/__fixtures__/app.ts": 'import "obsidian";\n',
          "src/core/view.ts": "export const view = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report).toEqual({ zone: "host-free", files: 1, violations: [] });
  });

  it.each([
    ["worker", { layer: "worker", files: { "src/query.ts": "" } }],
    ["host-free", { files: { "src/core/query.ts": "" } }],
    ["obsidian", { files: { "src/obsidian/query.ts": "" } }],
    ["desktop", { files: { "src/desktop/query.ts": "" } }],
  ] as const)(
    "reports reach from %s plugin code to a test-support package",
    async (zone, feature) => {
      const [file] = Object.keys(feature.files);
      await using ws = await workspace({
        testing: {
          layer: "test-support",
          files: { "src/scenario.ts": "export const scenario = 1;\n" },
        },
        feature: {
          ...feature,
          dependencies: ["testing"],
          files: {
            [file!]:
              'import { scenario } from "@ws/testing/scenario.ts";\nexport const s = scenario;\n',
          },
        },
      });
      const report = await checkZone(ws.root, zone);
      expect(report.violations).toEqual([
        {
          file: `packages/feature/${file}`,
          rule: "Plugin code loads no test support; packages/testing/src/scenario.ts is test support.",
          chain: [
            `packages/feature/${file}`,
            "packages/testing/src/scenario.ts",
          ],
        },
      ]);
    },
  );

  it("reports reach to a __fixtures__ file and leaves it out of the checked set", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/obsidian/view.ts":
            'import { host } from "./__fixtures__.ts";\nexport const h = host;\n',
          "src/obsidian/__fixtures__.ts":
            'export { host } from "../desktop/host.ts";\n',
          "src/desktop/host.ts": "export const host = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "obsidian");
    expect(report).toEqual({
      zone: "obsidian",
      files: 1,
      violations: [
        {
          file: "packages/feature/src/obsidian/view.ts",
          rule: "Plugin code loads no test support; packages/feature/src/obsidian/__fixtures__.ts is test support.",
          chain: [
            "packages/feature/src/obsidian/view.ts",
            "packages/feature/src/obsidian/__fixtures__.ts",
          ],
        },
      ],
    });
  });

  it("reports an Obsidian file that reaches the desktop zone", async () => {
    await using ws = await workspace({
      "obsidian-desktop": {
        layer: "desktop",
        files: { "src/require.ts": "export const load = 1;\n" },
      },
      kit: {
        layer: "obsidian",
        dependencies: ["obsidian-desktop"],
        files: {
          "src/confirm.ts":
            'import { load } from "@ws/obsidian-desktop/require.ts";\nexport const l = load;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "obsidian");
    expect(report.violations).toEqual([
      {
        file: "packages/kit/src/confirm.ts",
        rule: "An Obsidian file loads in Obsidian on Mobile and desktop, where Node and Electron are absent; packages/obsidian-desktop/src/require.ts is in the desktop zone.",
        chain: [
          "packages/kit/src/confirm.ts",
          "packages/obsidian-desktop/src/require.ts",
        ],
      },
    ]);
  });

  it("follows test support from a root and reports its reach to the desktop zone", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/__fixtures__/host.ts":
            'import { stub } from "./stub.ts";\nimport { view } from "../obsidian/view.ts";\nexport const host = [stub, view];\n',
          "src/__fixtures__/stub.ts":
            'import { load } from "../desktop/load.ts";\nexport const stub = load;\n',
          "src/obsidian/view.ts": "export const view = 1;\n",
          "src/desktop/load.ts": "export const load = 1;\n",
        },
      },
    });
    const report = await checkRoot(ws.root, "obsidian", [
      "packages/feature/src/__fixtures__/host.ts",
    ]);
    expect(report).toEqual({
      zone: "obsidian",
      files: 1,
      violations: [
        {
          file: "packages/feature/src/__fixtures__/host.ts",
          rule: "An Obsidian file loads in Obsidian on Mobile and desktop, where Node and Electron are absent; packages/feature/src/desktop/load.ts is in the desktop zone.",
          chain: [
            "packages/feature/src/__fixtures__/host.ts",
            "packages/feature/src/__fixtures__/stub.ts",
            "packages/feature/src/desktop/load.ts",
          ],
        },
      ],
    });
  });

  it("passes an Obsidian file that imports obsidian", async () => {
    await using ws = await workspace({
      feature: {
        files: {
          "src/obsidian/view.ts":
            'import { App } from "obsidian";\nexport const app = App;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "obsidian");
    expect(report).toEqual({ zone: "obsidian", files: 1, violations: [] });
  });

  it("reads the zones of a package's layer folders from its manifest", async () => {
    await using ws = await workspace({
      reads: {
        layers: { contract: "worker", client: "obsidian" },
        files: {
          "src/contract/rpc.ts": 'import "../client/service.ts";\n',
          "src/client/service.ts": "export const service = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report).toEqual({
      zone: "worker",
      files: 1,
      violations: [
        {
          file: "packages/reads/src/contract/rpc.ts",
          rule: "A Worker file loads in a Web Worker on each host, where the DOM and the obsidian module are absent; packages/reads/src/client/service.ts is in the Obsidian zone.",
          chain: [
            "packages/reads/src/contract/rpc.ts",
            "packages/reads/src/client/service.ts",
          ],
        },
      ],
    });
  });

  it("reports reach to a workspace file without a zone", async () => {
    await using ws = await workspace({
      i18n: { files: { "src/logger.ts": "export const log = 1;\n" } },
      feature: {
        dependencies: ["i18n"],
        files: {
          "src/core/view.ts":
            'import { log } from "@ws/i18n/logger.ts";\nexport const l = log;\n',
        },
      },
    });
    const report = await checkZone(ws.root, "host-free");
    expect(report.violations).toEqual([
      {
        file: "packages/feature/src/core/view.ts",
        rule: "packages/i18n/src/logger.ts has no zone, so the check cannot tell where it loads. State the zone of its package or folder.",
        chain: [
          "packages/feature/src/core/view.ts",
          "packages/i18n/src/logger.ts",
        ],
      },
    ]);
  });

  it("lets a package's layers entry override a shared layer folder", async () => {
    await using ws = await workspace({
      engine: {
        layer: "worker",
        layers: { core: "worker" },
        files: {
          "src/query.ts": 'import "./core/plan.ts";\n',
          "src/core/plan.ts": "export const plan = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report).toEqual({ zone: "worker", files: 2, violations: [] });
  });

  it("lets a layer folder win over the package's layer", async () => {
    await using ws = await workspace({
      engine: {
        layer: "worker",
        files: {
          "src/query.ts": 'import "./desktop/client.ts";\n',
          "src/desktop/client.ts": "export const client = 1;\n",
        },
      },
    });
    const report = await checkZone(ws.root, "worker");
    expect(report.violations).toEqual([
      {
        file: "packages/engine/src/query.ts",
        rule: "A Worker file loads in a Web Worker on each host, where the DOM and the obsidian module and Node and Electron are absent; packages/engine/src/desktop/client.ts is in the desktop zone.",
        chain: [
          "packages/engine/src/query.ts",
          "packages/engine/src/desktop/client.ts",
        ],
      },
    ]);
  });
});
