// Builds the two files Obsidian loads, `main.js` and `styles.css`, at the
// root of this repository.
//
// The plugin's code comes from its bundle package, the one entry of
// `dependencies` in package.json. That package holds the plugin as one ES
// module, with ZotLit's own code and its third-party code already bundled, and
// the finished stylesheet. This build turns the module into the CommonJS file
// Obsidian requires and minifies it; it reads no environment variable.
//
// ZotLit's source repository (README.md links it) runs this same file for its
// own release build, so the two `main.js` files match byte for byte.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, parseAst } from "vite";

/** The modules Obsidian provides at runtime. The plugin requires them, so the build leaves them out. */
export const HOST_MODULES = [
  "obsidian",
  "electron",
  "@electron/remote",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  ...[...builtinModules, "original-fs", "original-fs/promises"].flatMap(
    (name) => [name, `node:${name}`],
  ),
];

/**
 * Writes `main.js` and `styles.css` into `outDir`.
 *
 * @param {object} options
 * @param {string} options.entry the module whose default export is the plugin class.
 * @param {string} options.styles the bundle package's stylesheet.
 * @param {string} options.outDir the folder Obsidian loads the plugin from.
 * @param {Record<string, string>} [options.alias] module names to resolve to a file.
 */
export async function buildPlugin({ entry, styles, outDir, alias = {} }) {
  const result = await build({
    configFile: false,
    envDir: false,
    root: dirname(entry),
    mode: "production",
    logLevel: "warn",
    publicDir: false,
    resolve: { alias },
    plugins: [lazyBuiltins()],
    build: {
      // The build hands back main.js, which is written below.
      write: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      minify: true,
      sourcemap: false,
      target: "es2025",
      lib: { entry, formats: ["cjs"], fileName: () => "main.js" },
      rolldownOptions: {
        external: HOST_MODULES,
        // The bundle package already runs every module in source order;
        // the option keeps that order when the module becomes CommonJS.
        output: { strictExecutionOrder: true, codeSplitting: false },
      },
    },
  });
  const files = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  const [main, ...others] = files;
  if (main?.type !== "chunk" || others.length > 0) {
    throw new Error("The build must produce one file, main.js.");
  }
  await writeFile(join(outDir, "main.js"), asciiOnly(main.code));
  await copyFile(styles, join(outDir, "styles.css"));
}

/**
 * The `require("node:…")` lines at the top of the CommonJS chunk: a binding,
 * with the interop line that may follow it, or a bare require.
 */
const BUILTIN_REQUIRE =
  /^let ([\w$]+) = require\("(node:[\w/]+)"\);\n(?:\1 = (__toESM[\w$]*)\(\1(, 1)?\);\n)?|^require\("node:[\w/]+"\);\n/gm;

/**
 * Makes each Node built-in module load at its first use. Rolldown puts every
 * `require` of the chunk at its top, so Obsidian would load all of them, also
 * the ones a start never uses, before the plugin's first line runs. This
 * plugin turns each binding into an object whose getter requires the module
 * once, and reads the binding through it. A require with no binding goes.
 *
 * @returns {import("vite").Plugin}
 */
function lazyBuiltins() {
  return {
    name: "lazy-builtins",
    renderChunk(code) {
      /** @type {[start: number, end: number, text: string][]} */
      const edits = [];
      const names = new Set();
      for (const match of code.matchAll(BUILTIN_REQUIRE)) {
        const [line, name, id, interop, flag = ""] = match;
        const load = interop
          ? `${interop}(require("${id}")${flag})`
          : `require("${id}")`;
        if (name) names.add(name);
        edits.push([
          match.index,
          match.index + line.length,
          name
            ? `let ${name}$m;\nconst ${name} = { get m() { return ${name}$m ??= ${load}; } };\n`
            : "",
        ]);
      }
      if (names.size === 0) return null;
      const bodyStart = Math.max(...edits.map(([, end]) => end));
      /**
       * Reads each use of a binding through its getter.
       *
       * @param {any} node an ESTree node.
       * @param {any} parent the node that holds it.
       * @param {string} key the property of `parent` that holds it.
       */
      const visit = (node, parent, key) => {
        if (node.type === "Identifier" && names.has(node.name)) {
          const isName =
            key === (parent.type === "MemberExpression" ? "property" : "key") &&
            !parent.computed;
          if (!isName && node.start >= bodyStart)
            edits.push([node.end, node.end, ".m"]);
          return;
        }
        for (const [childKey, child] of Object.entries(node)) {
          for (const item of Array.isArray(child) ? child : [child])
            if (typeof item?.type === "string") visit(item, node, childKey);
        }
      };
      visit(parseAst(code), {}, "");
      edits.sort(([a], [b]) => a - b);
      let lazy = "";
      let at = 0;
      for (const [start, end, text] of edits) {
        lazy += code.slice(at, start) + text;
        at = end;
      }
      return { code: lazy + code.slice(at), map: null };
    },
  };
}

/**
 * `code` with each character outside ASCII written as a `\uXXXX` escape.
 * V8 keeps a script that is all ASCII as a one-byte string, half the size of
 * the two-byte string one other character forces on the whole file, so
 * Obsidian reads and compiles `main.js` faster at every start. The minified
 * code holds such characters in string, template and regular expression
 * literals, where the escape means the same character.
 *
 * @param {string} code
 */
function asciiOnly(code) {
  return code.replaceAll(
    /[\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const [bundle, ...others] = Object.keys(manifest.dependencies ?? {});
  if (!bundle || others.length > 0) {
    throw new Error(
      "package.json must list one dependency: the plugin's bundle package.",
    );
  }
  await buildPlugin({
    entry: join(root, "src/main.ts"),
    styles: createRequire(manifestPath).resolve(`${bundle}/styles.css`),
    outDir: root,
  });
}
