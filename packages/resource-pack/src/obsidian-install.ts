// What Obsidian 1.15.1 does to a plugin's `main.js` when it installs or updates
// the plugin (`installPlugin` in its app.js): it removes each inline source-map
// line and appends a marker. The container tests and the bundle check apply it
// to a built pack before they read the entries back.

const SOURCE_MAP_LINE =
  /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gmu;

const INSTALL_TAIL = "\n/* nosourcemap */";

/** The text Obsidian writes for a downloaded `main.js`. */
export function applyObsidianInstall(mainJs: string): string {
  return mainJs.replaceAll(SOURCE_MAP_LINE, "") + INSTALL_TAIL;
}
