import type { PackReport } from "#pack-gate";

// The kinds of published plugin, a profile each: what a plugin of the kind
// ships, and how its bundle package, its shell and its bundle check differ
// from the other kind's. Each entry of `PUBLISHED_PLUGINS` names its profile,
// and the scripts read the profile's fields.
import { SOURCE_REPOSITORY } from "@zotlit/config/repositories";
import { parsePackPins } from "@zotlit/resource-pack/pins.ts";

import { LEGAL_FILES } from "./bundle-package.ts";

import { checkPack } from "#pack-gate";

export type BuiltFileName = "main.js" | "styles.css";

export interface PluginProfile {
  /** The files the shell's build writes and the release uploads. */
  readonly builtFiles: readonly BuiltFileName[];
  /**
   * Whether the shell bundles the plugin through an entry module. The shell
   * then carries `src/main.ts`, its `tsconfig.json` and the pinned bundler,
   * and the bundle package carries the type of its default export.
   */
  readonly entryModule: boolean;
  /** The shell's files this kind has its own text of, relative to `templates/`. */
  readonly templates: {
    /** The shell's `scripts/build.mjs`. */
    readonly buildScript: string;
    /** The shell's `.github/workflows/plugin-release.yml`. */
    readonly releaseWorkflow: string;
  };
  /** The value of each `@@NAME@@` of the release workflow that the kind fills. */
  readonly workflowValues: Readonly<Record<string, string>>;
  /** The fields of the bundle package's package.json that name its files. */
  readonly bundlePackage: {
    readonly files: readonly string[];
    readonly [field: string]: unknown;
  };
  /** The bundle package's README after its first paragraph: its files, and how the shell builds from them. */
  bundleContents(facts: {
    /** The plugin's name in Obsidian. */
    readonly name: string;
    readonly version: string;
    /** The host app's folder, relative to the workspace root. */
    readonly app: string;
  }): string;
  /**
   * The start of the shell README's "About this repository" section: what the
   * repository publishes, and what its build does.
   */
  aboutRepository(facts: {
    readonly name: string;
    readonly bundlePackage: string;
  }): string;
  /** The checks of `main.js` that the kind adds to the bundle check, from the host app's package.json. */
  checkMain(mainJs: string, appPackage: unknown): Promise<PackReport>;
}

const source = `[${SOURCE_REPOSITORY}](https://github.com/${SOURCE_REPOSITORY})`;
const npmLink = (name: string) =>
  `[\`${name}\`](https://www.npmjs.com/package/${name})`;

/**
 * A bundled plugin: an ES module and a stylesheet, which the shell bundles
 * into `main.js` and `styles.css`, and a Resource Release per version.
 */
export function bundledPlugin(options: {
  /**
   * What the plugin downloads at runtime from the Resource Release of its
   * version, as the release notes name it.
   */
  readonly resources: string;
}): PluginProfile {
  return {
    builtFiles: ["main.js", "styles.css"],
    entryModule: true,
    templates: {
      buildScript: "scripts/build.mjs",
      releaseWorkflow: ".github/workflows/plugin-release.yml",
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

/**
 * A Resource Pack container: `main.js` alone, which the app's own build
 * writes and every later step ships byte for byte. Its package.json pins each
 * Pack Entry under `packEntries`. Its publish repository makes no Resource
 * Release.
 */
export const CONTAINER_PLUGIN: PluginProfile = {
  builtFiles: ["main.js"],
  entryModule: false,
  templates: {
    buildScript: "scripts/build-container.mjs",
    releaseWorkflow: ".github/workflows/plugin-release-container.yml",
  },
  workflowValues: {},
  bundlePackage: {
    // main.js is a CommonJS file that the shell copies and never loads.
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
