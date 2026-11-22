import type { PackReport } from "#pack-gate";

import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";
import { parsePackPins } from "@zotlit/resource-pack/pins.ts";

import { LEGAL_FILES } from "./legal-files.ts";

import { checkPack } from "#pack-gate";

export type BuiltFileName = "main.js" | "styles.css";

export const SHELL_BUILD_SCRIPT = "scripts/build.mjs";
export const SHELL_RELEASE_WORKFLOW = ".github/workflows/plugin-release.yml";

export interface PluginProfile {
  readonly builtFiles: readonly BuiltFileName[];
  readonly entryModule: boolean;
  readonly templates: {
    readonly buildScript: string;
    readonly releaseWorkflow: string;
  };
  readonly workflowValues: Readonly<Record<string, string>>;
  readonly bundlePackage: {
    readonly files: readonly string[];
    readonly [field: string]: unknown;
  };
  bundleContents(facts: {
    readonly name: string;
    readonly version: string;
    readonly app: string;
  }): string;
  aboutRepository(facts: {
    readonly name: string;
    readonly bundlePackage: string;
  }): string;
  checkMain(mainJs: string, appPackage: unknown): Promise<PackReport>;
}

const source = `[${SOURCE_REPOSITORY}](https://github.com/${SOURCE_REPOSITORY})`;
const npmLink = (name: string) =>
  `[\`${name}\`](https://www.npmjs.com/package/${name})`;

export function bundledPlugin(options: {
  readonly resources: string;
}): PluginProfile {
  return {
    builtFiles: ["main.js", "styles.css"],
    entryModule: true,
    templates: {
      buildScript: SHELL_BUILD_SCRIPT,
      releaseWorkflow: SHELL_RELEASE_WORKFLOW,
    },
    workflowValues: { RESOURCES: options.resources },
    bundlePackage: {
      type: "module",
      exports: {
        ".": { types: "./main.d.ts", default: "./main.js" },
        "./styles.css": "./styles.css",
        "./package.json": "./package.json",
      },
      files: [
        "main.js",
        "main.d.ts",
        "styles.css",
        "resources",
        ...LEGAL_FILES,
      ],
      sideEffects: true,
    },
    bundleContents: ({
      name,
      version,
      app,
    }) => `- \`main.js\`: the plugin as one ES module. It holds ${name}'s code and its
  third-party code. It imports only the modules Obsidian provides at runtime.
- \`styles.css\`: the plugin's stylesheet.
- \`resources/\`: the files the plugin downloads at runtime from the Resource
  Release \`res-${version}\` of the publish repository.

Obsidian does not load this package. The publish repository builds the
plugin's \`main.js\` and \`styles.css\` from it with \`scripts/build.mjs\`. The
source code is in ${source},
under \`${app}\`.
`,
    aboutRepository: ({
      name,
      bundlePackage,
    }) => `This repository publishes ${name}: its releases, and the Resource Releases
(\`res-<version>\`) that the plugin downloads at runtime. Its tree builds the
plugin from the npm package
${npmLink(bundlePackage)}
at the version that \`package.json\` names: \`pnpm install\`, then
\`pnpm run build\` writes \`main.js\` and \`styles.css\`.`,
    checkMain: async () => ({ lines: [], failures: [] }),
  };
}

export const CONTAINER_PLUGIN: PluginProfile = {
  builtFiles: ["main.js"],
  entryModule: false,
  templates: {
    buildScript: "scripts/build-container.mjs",
    releaseWorkflow: ".github/workflows/plugin-release-container.yml",
  },
  workflowValues: {},
  bundlePackage: {
    exports: {
      "./main.js": "./main.js",
      "./package.json": "./package.json",
    },
    files: ["main.js", ...LEGAL_FILES],
  },
  bundleContents: ({
    app,
  }) => `- \`main.js\`: the file Obsidian installs. It holds a small plugin class, and
  the data files as text inside comments, each with its licence. An index on
  its first line names each data file by its byte offset, so every copy of
  the file is byte for byte.

Obsidian does not load this package. The publish repository copies
\`main.js\` from it with \`scripts/build.mjs\`. The source code is in
${source}, under
\`${app}\`.
`,
  aboutRepository: ({
    name,
    bundlePackage,
  }) => `This repository publishes ${name}: its releases. Its tree takes the pack from
the npm package
${npmLink(bundlePackage)}
at the version that \`package.json\` names: \`pnpm install\`, then
\`pnpm run build\` copies \`main.js\` from the package, byte for byte.`,
  checkMain: (mainJs, appPackage) =>
    checkPack(mainJs, parsePackPins(appPackage)),
};
