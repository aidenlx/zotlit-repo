import { fileURLToPath } from "node:url";

export const obsidianMock: string = fileURLToPath(
  new URL("./src/__mocks__/obsidian.ts", import.meta.url),
);

export const obsidianSetupFile: string = fileURLToPath(
  new URL("./vitest.setup.js", import.meta.url),
);

export function packageSource(packageJson: string): string {
  return fileURLToPath(new URL("./src/", packageJson));
}
