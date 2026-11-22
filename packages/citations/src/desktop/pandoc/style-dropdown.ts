import type { ReferencesStyleOption } from "#core/pandoc/citation-style.ts";
import type { InstalledCslStyle } from "#core/pandoc/csl-style.ts";
import { Effect, FileSystem } from "effect";
import type { Setting } from "obsidian";

import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import { listInstalledStylesOrNone } from "./installed-styles.ts";

export interface StyleDropdownOptions {
  dataDir: string;
  fileSystem: FileSystem.FileSystem;
  bridge: Pick<EffectBridge, "runPromiseExit">;
  value: string;
  options: (
    styles: readonly InstalledCslStyle[],
    selected: string,
  ) => ReferencesStyleOption[];
  onChange: (value: string) => void;
}

export function addStyleDropdown(
  setting: Setting,
  {
    dataDir,
    fileSystem,
    bridge,
    value,
    options,
    onChange,
  }: StyleDropdownOptions,
): void {
  setting.addDropdown((dropdown) => {
    let styles: readonly InstalledCslStyle[] = [];
    let selected = value;
    const repopulate = (): void => {
      dropdown.selectEl.replaceChildren();
      for (const [index, entry] of options(styles, selected).entries()) {
        dropdown.addOption(entry.value, entry.label);
        if (entry.disabled) dropdown.selectEl.options[index]!.disabled = true;
      }
      dropdown.setValue(selected);
    };
    repopulate();
    dropdown.onChange((next) => {
      selected = next;
      onChange(next);
    });
    void bridge
      .runPromiseExit(
        listInstalledStylesOrNone(dataDir).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      )
      .then((exit) => {
        const installed = valueOr(exit, null);
        if (installed === null) return;
        styles = installed;
        repopulate();
      });
  });
}
