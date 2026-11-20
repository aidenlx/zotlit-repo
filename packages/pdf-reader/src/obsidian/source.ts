import type { DocumentSource } from "#/core/index.ts";
import type { App, TFile } from "obsidian";

export function vaultSource(app: App, file: TFile): DocumentSource {
  return {
    get key() {
      return file.path;
    },
    get name() {
      return file.name;
    },
    read: async () => new Uint8Array(await app.vault.readBinary(file)),
    watch: (onChange) => {
      const ref = app.vault.on("modify", (changed) => {
        if (changed === file) onChange();
      });
      return () => app.vault.offref(ref);
    },
  };
}
