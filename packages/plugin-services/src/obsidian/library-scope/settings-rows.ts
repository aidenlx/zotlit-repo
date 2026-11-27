import type {} from "#core/library-scope/settings.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
import { Effect } from "effect";
import type {
  Setting,
  SettingDefinition,
  SettingDefinitionList,
} from "obsidian";
import { Menu } from "obsidian";

import { showMenuAtButton } from "@zotlit/obsidian-kit/menu.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  compareSelectors,
  DEFAULT_LIBRARY_SCOPE,
  MY_LIBRARY_SCOPE,
  selectorKey,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  AvailableLibrary,
  LibraryScope,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";

import { LibraryScope as LibraryScopeService } from "./service.ts";

import { libraryLabel, selectorLabel } from "#core/library-scope/label.ts";
import { PluginSettings } from "#obsidian/settings/service.ts";

const effectiveScope = LibraryScopeService.use((scope) => scope.effective);
const resolvedScope = LibraryScopeService.use((scope) => scope.current);
const savedScopeInvalid = LibraryScopeService.use((scope) => scope.invalid);
const availableLibraries = LibraryScopeService.use((scope) => scope.libraries);

interface SelectedEntry {
  selector: LibrarySelector;
  label: string;
  unavailable: boolean;
}

export function libraryScopeRow(
  ctx: SettingTabContext,
): SettingDefinition<SettingsKey> {
  const scope = ctx.tab.sync(effectiveScope);
  return {
    id: "settings_library_scope",
    name: m.settings_library_scope_name(),
    desc: describeScope(ctx),
    render: (setting) => renderModeRow(setting, ctx, scope),
  };
}

export function selectedLibrariesList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsKey> {
  const scope = ctx.tab.sync(effectiveScope);
  const editable = isEditable(ctx);
  const entries = selectedEntries(ctx, scope);
  return {
    type: "list",
    id: "settings_library_scope_selected",
    heading: m.settings_library_scope_selected(),
    visible: () => scope.mode === "selected",
    onDelete:
      editable && entries.length > 1
        ? (index) => removeSelector(ctx, scope, index)
        : undefined,
    addItem: editable
      ? {
          name: m.settings_library_scope_add(),
          action: (el) => openAddMenu(el, ctx, scope),
        }
      : undefined,
    items: entries.map((entry) => ({
      id: `settings_library_scope_entry:${selectorKey(entry.selector)}`,
      name: entry.label,
      desc: entry.unavailable
        ? m.settings_library_scope_unavailable()
        : undefined,
      searchable: false,
    })),
  };
}

function isEditable(ctx: SettingTabContext): boolean {
  return ctx.tab.sync(resolvedScope) !== null;
}

function describeScope(ctx: SettingTabContext): DocumentFragment {
  const desc = createFragment();
  desc.append(m.settings_library_scope_desc());
  const warning = ctx.tab.sync(savedScopeInvalid)
    ? m.settings_library_scope_invalid()
    : ctx.tab.sync(resolvedScope) === null
      ? m.settings_library_scope_db_unavailable()
      : null;
  if (warning) {
    desc.append(createEl("br"));
    const warningEl = createSpan({ cls: "mod-warning", text: warning });
    desc.append(warningEl);
  }
  return desc;
}

function renderModeRow(
  setting: Setting,
  ctx: SettingTabContext,
  scope: LibraryScope,
): void {
  setting.addDropdown((dropdown) => {
    dropdown
      .addOption("all", m.settings_library_scope_all())
      .addOption("selected", m.settings_library_scope_selected())
      .setValue(scope.mode)
      .setDisabled(!isEditable(ctx))
      .onChange((value) => {
        saveScope(
          ctx,
          value === "all" ? DEFAULT_LIBRARY_SCOPE : MY_LIBRARY_SCOPE,
        );
      });
  });
}

function selectedEntries(
  ctx: SettingTabContext,
  scope: LibraryScope,
): SelectedEntry[] {
  if (scope.mode !== "selected") return [];
  const resolved = ctx.tab.sync(resolvedScope);
  const byKey = new Map(
    resolved?.available.map((library) => [
      selectorKey(library.selector),
      library,
    ]),
  );
  return scope.libraries.map((selector) => {
    const library = byKey.get(selectorKey(selector));
    return {
      selector,
      label: library ? libraryLabel(library) : selectorLabel(selector),
      unavailable: resolved !== null && library === undefined,
    };
  });
}

function addableLibraries(
  ctx: SettingTabContext,
  scope: LibraryScope,
): AvailableLibrary[] {
  if (scope.mode !== "selected") return [];
  const selected = new Set(scope.libraries.map(selectorKey));
  return ctx.tab
    .sync(availableLibraries)
    .filter((library) => !selected.has(selectorKey(library.selector)));
}

function openAddMenu(
  el: HTMLElement,
  ctx: SettingTabContext,
  scope: LibraryScope,
): void {
  const candidates = addableLibraries(ctx, scope);
  const menu = new Menu();
  if (candidates.length === 0) {
    menu.addItem((item) =>
      item.setTitle(m.settings_library_scope_add_none()).setDisabled(true),
    );
  }
  for (const library of candidates) {
    menu.addItem((item) =>
      item
        .setTitle(libraryLabel(library))
        .onClick(() => addSelector(ctx, scope, library.selector)),
    );
  }
  showMenuAtButton(menu, el);
}

function addSelector(
  ctx: SettingTabContext,
  scope: LibraryScope,
  selector: LibrarySelector,
): void {
  if (scope.mode !== "selected") return;
  saveScope(ctx, {
    mode: "selected",
    libraries: [...scope.libraries, selector].sort(compareSelectors),
  });
}

function removeSelector(
  ctx: SettingTabContext,
  scope: LibraryScope,
  index: number,
): void {
  if (scope.mode !== "selected") return;
  const libraries = scope.libraries.filter((_, at) => at !== index);
  if (libraries.length === 0) return;
  saveScope(ctx, { mode: "selected", libraries });
}

function saveScope(ctx: SettingTabContext, scope: LibraryScope): void {
  void ctx.tab.run(
    PluginSettings.use((settings) =>
      settings.update({ "zotero.library-scope": scope }),
    ).pipe(Effect.andThen(ctx.tab.update)),
    m.settings_failed_save(),
  );
}

declare module "#obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    LibraryScope: LibraryScopeService;
  }
}
