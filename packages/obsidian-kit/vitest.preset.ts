// What a Vitest config of plugin code needs to load Obsidian's API: the
// `obsidian` package is types-only, so tests import this stand-in, and the
// setup file adds the DOM helpers Obsidian patches onto every window.
import { fileURLToPath } from "node:url";

/** The runtime stand-in for the `obsidian` module; alias `obsidian` to it. */
export const obsidianMock: string = fileURLToPath(
  new URL("./src/__mocks__/obsidian.ts", import.meta.url),
);

/** The setup file that patches the window globals Obsidian adds. */
export const obsidianSetupFile: string = fileURLToPath(
  new URL("./vitest.setup.js", import.meta.url),
);

/**
 * The source folder of a workspace package, the plugin code it holds, from the
 * URL of its `package.json` as the caller resolves it
 * (`import.meta.resolve("@zotlit/obsidian-kit/package.json")`).
 */
export function packageSource(packageJson: string): string {
  return fileURLToPath(new URL("./src/", packageJson));
}
