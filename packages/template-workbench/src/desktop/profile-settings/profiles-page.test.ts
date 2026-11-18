import type { CustomizeRequest } from "#desktop/local-bridge/customize.ts";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer, Queue } from "effect";
import { SuggestModal, TFile } from "obsidian";
import type {
  App,
  Modal as ObsidianModal,
  ExtraButtonComponent as ObsidianExtraButton,
  SettingDefinitionItem,
  SettingDefinitionList,
  SettingDefinitionPage,
} from "obsidian";
import { describe, expect, vi } from "vitest";

import { profileReader } from "@zotlit/notes/__fixtures__/profile/reader.ts";
import { defaults } from "@zotlit/notes/__fixtures__/settings.ts";
import {
  literatureNoteItems,
  literatureNoteSlots,
} from "@zotlit/notes/obsidian/profile/main-page-rows.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import type {
  LiteratureNoteProfile,
  ProfileCreation,
} from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { answerConfirmation } from "@zotlit/obsidian-kit/__fixtures__/confirm.ts";
import {
  ButtonComponent,
  ExtraButtonComponent,
  Menu,
  Modal,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Setting } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import {
  eventually,
  until,
} from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import {
  defaultDocumentItem,
  partialItems,
  profilesPage,
} from "./profiles-page.ts";

import { rebuildingSettingTab } from "#__fixtures__/setting-tab.ts";
import { Customize } from "#desktop/local-bridge/customize.ts";
import { openTemplateWorkbench } from "#desktop/view/open.ts";
import { openNewPartialPrompt } from "#obsidian/view/new-partial.ts";

vi.mock("#desktop/view/open.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#desktop/view/open.ts")>()),
  openTemplateWorkbench: vi.fn(() => Effect.void),
}));
vi.mock("#obsidian/view/new-partial.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#obsidian/view/new-partial.ts")>()),
  openNewPartialPrompt: vi.fn(),
}));

const books = "Bk3Qn7XvT2Lp" as ProfileId;
const DEFAULT_DOCUMENT = "templates/zotlit-profile.default.md";
const BOOKS: LiteratureNoteProfile = {
  id: books,
  label: "Books",
  document: "zotlit-profile.books.md",
  path: "templates/zotlit-profile.books.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

function fileAt(path: string): TFile {
  const file = new TFile();
  file.path = path;
  for (const field of [
    "vault",
    "name",
    "parent",
    "stat",
    "basename",
    "extension",
  ])
    Reflect.deleteProperty(file, field);
  return file;
}

/**
 * The tab context over typed fakes of the services the Profile rows read: a
 * loaded registry with no Profile and no saved Default document, unless a
 * case overrides a member. `rebuilt` takes one element per rebuild an action
 * asks for, which a successful action asks for when it ends.
 */
const tabOver = Effect.fnUntraced(function* (
  fakes: {
    profile?: Partial<Profile["Service"]>;
    vault?: Partial<Vault["Service"]>;
    fileManager?: Partial<FileManager["Service"]>;
    settings?: Settings;
  } = {},
) {
  const settings = {
    current: Effect.succeed(fakes.settings ?? defaults),
    update: vi.fn(
      (_patch: Parameters<PluginSettings["Service"]["update"]>[0]) =>
        Effect.succeed(fakes.settings ?? defaults),
    ),
  };
  const customize = vi.fn((_request: CustomizeRequest) => {});
  const { tab, rebuilt } = yield* rebuildingSettingTab(
    Layer.mergeAll(
      Layer.mock(Customize, {
        open: (request) => Effect.sync(() => customize(request)),
      }),
      Layer.mock(Profile, {
        loaded: Effect.succeed(true),
        profiles: Effect.succeed([]),
        diagnostics: Effect.succeed([]),
        defaultDocumentPath: Effect.succeed(DEFAULT_DOCUMENT),
        ...fakes.profile,
      }),
      Layer.mock(Template, {
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
      }),
      Layer.mock(Vault, {
        getFileByPath: () => Effect.succeed(null),
        ...fakes.vault,
      }),
      Layer.mock(FileManager, fakes.fileManager ?? {}),
      Layer.mock(PluginSettings, settings),
    ),
  );
  // The main page's document slot holds the row this package gives it; the
  // host's tab binds the Profile control keys of every slot's rows.
  const ctx: SettingTabContext = stubService<SettingTabContext>(
    "SettingTabContext",
    {
      tab,
      app: stubService<App>("App", {}),
      slot: (id) =>
        id === literatureNoteSlots.document
          ? [defaultDocumentItem(ctx) as SettingDefinitionItem<SettingsKey>]
          : [],
    },
  );
  return { ctx, rebuilt, customize };
});

/** A vault that holds every path, the saved Default document included. */
const everyFile = {
  getFileByPath: (path: string) => Effect.succeed(fileAt(path)),
};

/** What a `render` row's buttons are labelled by, icon tooltip included. */
function buttonLabels(row: SettingDefinitionItem): string[] {
  return renderRow(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .map((button) => button.text || button.tooltip);
}

/** The icons a `render` row's buttons carry, in order. */
function buttonIcons(row: SettingDefinitionItem): string[] {
  return renderRow(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .map((button) => button.icon);
}

/** The list a page carries under `heading`. */
function list(
  page: SettingDefinitionPage,
  heading: string,
): SettingDefinitionList {
  const found = page.items?.find(
    (row): row is SettingDefinitionList =>
      "type" in row && row.type === "list" && row.heading === heading,
  );
  if (!found) throw new Error(`No list headed ${heading}`);
  return found;
}

/** The Template document row of the main page. */
function documentRow(ctx: SettingTabContext): SettingDefinitionItem {
  const row = literatureNoteItems(ctx).find(
    (item) =>
      "name" in item && item.name === m.settings_profile_document_name(),
  );
  if (!row) throw new Error("No Template document row");
  return row;
}

/** The tooltips a `render` row's icon buttons carry, in order. */
function extraButtonTooltips(row: SettingDefinitionItem): string[] {
  return renderRow(row)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .map((button) => button.tooltip);
}

/** The Profiles page's Default row and the row of its one other Profile. */
function pageRows(ctx: SettingTabContext): {
  defaultRow: SettingDefinitionItem;
  profileRow: SettingDefinitionItem;
} {
  const page = profilesPage(ctx);
  return {
    defaultRow: page.items![0]!,
    profileRow: list(page, m.settings_profile_other_heading()).items![0]!,
  };
}

/** The titles of the menu a row's More actions button opens. */
function moreActions(row: SettingDefinitionItem): string[] {
  const more = renderRow(row)
    .components.filter((control) => control instanceof ExtraButtonComponent)
    .find((button) => button.icon === "more-horizontal")!;
  Object.assign(more, { extraSettingsEl: document.createElement("button") });
  more.click();
  return Menu.instances.at(-1)!.items.map((item) => item.title);
}

function customizeButton(row: SettingDefinitionItem): ButtonComponent {
  const button = renderRow(row)
    .components.filter((control) => control instanceof ButtonComponent)
    .find(({ tooltip }) => tooltip === m.settings_profile_edit());
  if (!button) throw new Error("No Customize button");
  return button;
}

describe("Profile settings", () => {
  it.effect(
    "opens the workbench from Edit and groups profile management in More actions",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
        });
        const { profileRow } = pageRows(ctx);
        expect(buttonLabels(profileRow)).toEqual([m.settings_profile_edit()]);
        expect(buttonIcons(profileRow)).toEqual(["pencil"]);
        expect(moreActions(profileRow)).toEqual([
          m.settings_profile_duplicate(),
          m.settings_profile_share(),
          m.settings_profile_delete(),
        ]);
      }),
  );

  it.effect("combines templates and properties in one editing row", () =>
    Effect.gen(function* () {
      const { ctx } = yield* tabOver();
      expect(
        literatureNoteItems(ctx).filter(
          (row) => "id" in row && /properties/.test(row.id),
        ),
      ).toEqual([]);
      expect(buttonIcons(documentRow(ctx))).toEqual(["pencil"]);
    }),
  );

  it.effect(
    "offers one Customize action for the built-in template, and Restore beside it for a saved one",
    () =>
      Effect.gen(function* () {
        const builtIn = yield* tabOver();
        expect(buttonLabels(documentRow(builtIn.ctx))).toEqual([
          m.settings_profile_edit(),
        ]);

        const saved = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
          vault: everyFile,
        });
        expect(buttonLabels(documentRow(saved.ctx))).toEqual([
          m.settings_profile_document_restore(),
          m.settings_profile_edit(),
        ]);
        const { defaultRow } = pageRows(saved.ctx);
        expect(buttonLabels(defaultRow)).toEqual([m.settings_profile_edit()]);
        expect(moreActions(defaultRow)).toEqual([
          m.settings_profile_share(),
          m.settings_profile_document_restore(),
        ]);

        customizeButton(documentRow(saved.ctx)).click();
        yield* Queue.take(saved.rebuilt);
        expect(saved.customize).toHaveBeenCalledWith({ profileId: "default" });
      }),
  );

  it.effect(
    "keeps native customization while the web Template Workbench is off",
    () =>
      Effect.gen(function* () {
        const settings = { ...defaults, "server.workbench": false };
        const builtIn = yield* tabOver({ settings });
        expect(buttonLabels(documentRow(builtIn.ctx))).toEqual([
          m.settings_profile_edit(),
        ]);

        const saved = yield* tabOver({ settings, vault: everyFile });
        expect(buttonLabels(documentRow(saved.ctx))).toEqual([
          m.settings_profile_document_restore(),
          m.settings_profile_edit(),
        ]);
      }),
  );

  it.effect(
    "keeps native Default customization and offers connected Profile customization",
    () =>
      Effect.gen(function* () {
        const { ctx, rebuilt, customize } = yield* tabOver({
          profile: { profiles: Effect.succeed([BOOKS]) },
        });
        const { defaultRow, profileRow } = pageRows(ctx);

        expect(extraButtonTooltips(defaultRow)).toEqual([
          m.workbench_more_actions(),
        ]);
        expect(extraButtonTooltips(profileRow)).toEqual([
          m.workbench_more_actions(),
        ]);
        expect(buttonLabels(defaultRow)).toContain(m.settings_profile_edit());

        // The row opens its own Profile through the configured workbench launcher.
        customizeButton(profileRow).click();
        yield* Queue.take(rebuilt);
        expect(customize).toHaveBeenCalledWith({ profileId: books });
      }),
  );

  it.effect("keeps More actions available while web access is off", () =>
    Effect.gen(function* () {
      const { ctx } = yield* tabOver({
        profile: { profiles: Effect.succeed([BOOKS]) },
        settings: { ...defaults, "server.workbench": false },
      });
      const { defaultRow, profileRow } = pageRows(ctx);

      expect(extraButtonTooltips(defaultRow)).toEqual([
        m.workbench_more_actions(),
      ]);
      expect(extraButtonTooltips(profileRow)).toEqual([
        m.workbench_more_actions(),
      ]);
    }),
  );

  it.effect(
    "withholds both ways in while a Profile write would race the load",
    () =>
      Effect.gen(function* () {
        const { ctx } = yield* tabOver({
          profile: { loaded: Effect.succeed(false) },
        });
        const profiles = list(
          profilesPage(ctx),
          m.settings_profile_other_heading(),
        );
        expect(profiles.addItem).toBeUndefined();
        expect(profiles.extraButtons).toBeUndefined();
      }),
  );
});

it.effect(
  "warns once about repeated IDs and lists each excluded file with its own actions",
  () =>
    Effect.gen(function* () {
      using confirmation = answerConfirmation(true);
      const paths = [
        "templates/zotlit-profile.one.md",
        "templates/zotlit-profile.two.md",
      ];
      const trashFile = vi.fn(() => Effect.void);
      const { ctx, rebuilt } = yield* tabOver({
        profile: {
          diagnostics: Effect.succeed(
            paths.map((path) => ({
              code: "duplicate-profile-id" as const,
              path,
              paths,
              message: "Repeated ID",
            })),
          ),
        },
        vault: everyFile,
        fileManager: { trashFile },
      });
      const page = profilesPage(ctx);
      const banners = page.items!.filter(
        (row) =>
          "name" in row && row.name === m.settings_profile_duplicate_id_name(),
      );
      expect(banners).toHaveLength(1);
      const banner = banners[0]!;
      // The guidance reads as a warning, so the fix is not mistaken for a setting.
      const desc = (banner as { desc: DocumentFragment }).desc;
      expect(desc.textContent).toBe(m.settings_profile_duplicate_banner());
      expect(
        (desc.firstElementChild as HTMLElement).classList.contains(
          "mod-warning",
        ),
      ).toBe(true);

      const excluded = list(page, m.settings_profile_excluded_heading());
      renderRow(excluded.items![0]!)
        .components.filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.tooltip === m.settings_template_open())!
        .click();
      yield* Queue.take(rebuilt);
      expect(openTemplateWorkbench).toHaveBeenCalledWith(
        expect.objectContaining({ path: paths[0] }),
      );

      // Deleting is the list's own affordance, addressed by row index.
      excluded.onDelete!(1);
      yield* Queue.take(rebuilt);
      expect(trashFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: paths[1] }),
      );
      expect(confirmation.opened).toHaveBeenCalledOnce();
    }),
);

it.effect(
  "collects a destination before creating a Profile and cancels without a write",
  () =>
    Effect.gen(function* () {
      const create = vi.fn(() => Effect.succeed(BOOKS));
      const resolved = profileReader().resolveProfile("default")!;
      const plan: ProfileCreation = {
        profile: resolved,
        source: "",
        inherited: [],
        constraint: {
          kind: "invalid-name",
          message: m.settings_profile_name_invalid(),
        },
        create,
      };
      const { ctx, rebuilt } = yield* tabOver({
        profile: {
          resolveProfile: () => Effect.succeed(resolved),
          prepareCreate: () => Effect.succeed(plan),
        },
      });
      const profiles = list(
        profilesPage(ctx),
        m.settings_profile_other_heading(),
      );
      const before = Modal.instances.length;
      profiles.addItem!.action(document.createElement("div"));
      yield* until(() => Modal.instances.length > before);
      const modal = Modal.instances.at(-1)!;
      modal.onOpen();
      expect(modal.title).toBe(m.settings_profile_add());
      expect(modal.contentEl.textContent).toContain(
        m.settings_profile_name_name(),
      );
      expect(modal.contentEl.textContent).toContain(
        m.settings_profile_folder_name(),
      );
      modal.close();
      modal.onClose();
      yield* Queue.take(rebuilt);
      expect(create).not.toHaveBeenCalled();
      expect(openTemplateWorkbench).not.toHaveBeenCalled();
    }),
);

it.effect("asks the import flow for its own source", () =>
  Effect.gen(function* () {
    using opened = vi.spyOn(SuggestModal.prototype, "open");
    const { ctx } = yield* tabOver();
    const profiles = list(
      profilesPage(ctx),
      m.settings_profile_other_heading(),
    );

    const button = new ExtraButtonComponent(document.createElement("div"));
    profiles.extraButtons![0]!(button as unknown as ObsidianExtraButton);
    expect(button.tooltip).toBe(m.command_import_profile_name());
    button.click();
    yield* eventually(() => expect(opened).toHaveBeenCalledOnce());
  }),
);

/**
 * The tab context over `template` and `vault`, for the Partials list, with a
 * settings window that closes through `close`. `rebuilt` takes one element
 * per definition rebuild an action asks for.
 */
const partialsTabOver = Effect.fnUntraced(function* (
  template: Partial<Template["Service"]>,
  options: {
    vault?: Partial<Vault["Service"]>;
    close?: () => void;
  } = {},
) {
  const { tab, rebuilt } = yield* rebuildingSettingTab(
    Layer.merge(
      Layer.mock(Template, template),
      Layer.mock(Vault, options.vault ?? {}),
    ),
    options,
  );
  const app = stubService<App>("App", {});
  const ctx = stubService<SettingTabContext>("SettingTabContext", { tab, app });
  return { ctx, rebuilt };
});

function tooltips(setting: Setting): string[] {
  return setting.components
    .filter((control) => control instanceof ButtonComponent)
    .map((button) => button.tooltip);
}

const AUTHORS = {
  name: "authors",
  path: "Templates/zotlit-partial.authors.md",
  language: "liquid",
} as const;
const VENUE = {
  name: "venue-line",
  path: "Templates/zotlit-partial.venue-line.md",
  language: "liquid",
} as const;

/** The Partials list of the Profiles page. */
function partialList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsKey> {
  const list = partialItems(ctx).find(
    (row): row is SettingDefinitionList<SettingsKey> =>
      "type" in row && row.type === "list",
  );
  if (!list) throw new Error("Expected the Partials list");
  return list;
}

it.effect("offers Open for each partial", () =>
  Effect.gen(function* () {
    const { ctx } = yield* partialsTabOver({
      loaded: Effect.succeed(true),
      getPartialDocuments: Effect.succeed([AUTHORS, VENUE]),
      getReservedPartialFiles: Effect.succeed([]),
    });
    const list = partialList(ctx);

    expect(tooltips(renderRow(list.items![0]!))).toEqual([
      m.settings_partial_open(),
    ]);
    expect(tooltips(renderRow(list.items![1]!))).toEqual([
      m.settings_partial_open(),
    ]);
  }),
);

it.effect(
  "holds Delete in the row's menu and trashes the partial once confirmed",
  () =>
    Effect.gen(function* () {
      using _answer = answerConfirmation(true);
      const deletePartial = vi.fn(() => Effect.void);
      const { ctx, rebuilt } = yield* partialsTabOver({
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([AUTHORS]),
        getReservedPartialFiles: Effect.succeed([]),
        deletePartial,
      });
      const more = renderRow(partialList(ctx).items![0]!)
        .components.filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.icon === "more-horizontal")!;
      Object.assign(more, {
        extraSettingsEl: document.createElement("button"),
      });
      more.click();

      const menu = Menu.instances.at(-1)!;
      expect(menu.items.map((item) => item.title)).toEqual([
        m.settings_partial_delete(),
      ]);
      menu.items[0]!.click();
      yield* Queue.take(rebuilt);
      expect(deletePartial).toHaveBeenCalledWith("authors");
    }),
);

it.effect("closes settings only once Add partial has created a document", () =>
  Effect.gen(function* () {
    const close = vi.fn();
    const createPartial = vi.fn(() => Effect.succeed(new TFile()));
    const partialFile = new TFile();
    partialFile.path = AUTHORS.path;
    const { ctx, rebuilt } = yield* partialsTabOver(
      {
        loaded: Effect.succeed(true),
        getPartialDocuments: Effect.succeed([]),
        getReservedPartialFiles: Effect.succeed([]),
        getPartialNames: Effect.succeed([]),
        createPartial,
      },
      {
        vault: { getFileByPath: () => Effect.succeed(partialFile) },
        close,
      },
    );
    const promptAnswers = (name: string | null) =>
      vi
        .mocked(openNewPartialPrompt)
        .mockImplementationOnce((_app, _prompt, settle) => {
          settle(name);
          return stubService<ObsidianModal>("Modal", { close: () => {} });
        });
    const list = partialList(ctx);

    promptAnswers(null);
    list.addItem!.action(document.createElement("button"));
    yield* Queue.take(rebuilt);
    expect(createPartial).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(openTemplateWorkbench).not.toHaveBeenCalled();

    promptAnswers("authors");
    list.addItem!.action(document.createElement("button"));
    yield* Queue.take(rebuilt);
    expect(createPartial).toHaveBeenCalledWith("authors", {});
    expect(close).toHaveBeenCalled();
    expect(openTemplateWorkbench).toHaveBeenCalledWith(partialFile, {
      explainUnsupported: false,
    });
  }),
);
