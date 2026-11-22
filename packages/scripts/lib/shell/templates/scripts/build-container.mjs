import { copyFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Writes `main.js` into `outDir`.
 *
 * @param {object} options
 * @param {string} options.main the bundle package's `main.js`.
 * @param {string} options.outDir the folder Obsidian loads the plugin from.
 */
export async function buildPlugin({ main, outDir }) {
  await copyFile(main, join(outDir, "main.js"));
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
    main: createRequire(manifestPath).resolve(`${bundle}/main.js`),
    outDir: root,
  });
}
