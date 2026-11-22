import type { WorkbenchHostDeps } from "#__fixtures__/view.ts";
import type { DefaultProfileTarget } from "#desktop/view/customize.ts";
// @vitest-environment happy-dom
import { Effect } from "effect";
import { MarkdownView, TFile } from "obsidian";
import type {
  App,
  Command,
  EventRef,
  Plugin,
  ViewState,
  WorkspaceLeaf,
} from "obsidian";
import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { defaults } from "@zotlit/notes/__fixtures__/settings.ts";
import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  Menu,
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { openTestBridge } from "@zotlit/plugin-kernel/__fixtures__/effect-bridge.ts";
import { testRuntime } from "@zotlit/plugin-kernel/__fixtures__/runtime.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { registerFileMenu } from "@zotlit/plugin-services/obsidian/file-menu.ts";

import {
  makeWorkbenchHost,
  workbenchActionContext,
} from "#__fixtures__/view.ts";

type RegistrationHostDeps = WorkbenchHostDeps & {
  profile: Profile["Service"];
};
const defaultTarget = (
  profile: Pick<Profile["Service"], "defaultDocumentPath">,
): DefaultProfileTarget => ({
  get defaultDocumentPath() {
    return Effect.runSync(profile.defaultDocumentPath);
  },
});
const builtInDefault = defaultTarget({
  defaultDocumentPath: Effect.succeed("templates/zotlit-profile.default.md"),
});

type LaunchServices = {
  profile?: Partial<Profile["Service"]>;
  notifier?: Notifier["Service"];
};

import type { WorkbenchActionServices } from "#desktop/editor/actions.ts";

import { findWorkbenchLayout, openWorkbenchLayout } from "./layout.ts";
import { openTemplateWorkbench } from "./open.ts";
import {
  registerTemplateWorkbenchView,
  templateWorkbenchFileMenu,
} from "./register.ts";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "./view.tsx";

vi.mock("./layout.ts", () => ({
  setLeafState: (leaf: WorkspaceLeaf, state: ViewState) =>
    Effect.tryPromise(() => leaf.setViewState(state)),
  WORKBENCH_WINDOW: { width: 1440, height: 900 },
  openWorkbenchLayout: vi.fn(() => Effect.void),
  findWorkbenchLayout: vi.fn(() => Effect.succeed(null)),
}));

const setOriginatingNote = vi.fn<
  (file: TFile | null) => Effect.Effect<string | null>
>(() => Effect.succeed(null));
beforeEach(() => {
  vi.spyOn(
    TemplateWorkbenchView.prototype,
    "setOriginatingNote",
  ).mockImplementation(setOriginatingNote);
});
afterEach(() => {
  vi.restoreAllMocks();
  resetMockPlatform();
  vi.mocked(findWorkbenchLayout)
    .mockReset()
    .mockReturnValue(Effect.succeed(null));
});

function appContext(
  app: App,
  { notifier = testNotifier().service, ...services }: LaunchServices = {},
) {
  return workbenchActionContext(notifier, {
    ...services,
    vault: {
      cachedRead: (file) => Effect.promise(() => app.vault.cachedRead(file)),
      getFileByPath: (path) => Effect.sync(() => app.vault.getFileByPath(path)),
    },
    workspace: {
      leavesOfType: (type) =>
        Effect.sync(() => app.workspace.getLeavesOfType(type)),
      getLeaf: (pane) => Effect.sync(() => app.workspace.getLeaf(pane)),
      openPopoutLeaf: (size) =>
        Effect.sync(() => app.workspace.openPopoutLeaf({ size })),
      revealLeaf: (leaf) =>
        Effect.promise(async () => app.workspace.revealLeaf(leaf)),
      createLeafBySplit: (leaf) =>
        Effect.sync(() => app.workspace.createLeafBySplit(leaf)),
      rootSplit: Effect.sync(() => app.workspace.rootSplit),
    },
  });
}

function launch<A, E>(
  app: App,
  open: Effect.Effect<A, E, WorkbenchActionServices>,
  services?: LaunchServices,
): Promise<A> {
  return Effect.runPromise(
    open.pipe(Effect.provideContext(appContext(app, services))),
  );
}

function testBridge() {
  const bridge = openTestBridge();
  onTestFinished(() => bridge[Symbol.asyncDispose]());
  return bridge;
}

type FileMenuHandler = (
  menu: Menu,
  file: TFile,
  ...origin: [source: string, leaf?: WorkspaceLeaf]
) => void;

function setup() {
  const file = new TFile();
  file.path = "templates/zotlit-profile.paper.md";
  file.basename = "zotlit-profile.paper";
  file.extension = "md";
  const setViewState = vi.fn(async () => {});
  const focusWindow = vi.fn();
  const container = stubService<App["workspace"]["rootSplit"]>(
    "WorkspaceContainer",
    { focus: focusWindow },
  );
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
    setViewState,
    getContainer: () => container,
    view: stubService<WorkspaceLeaf["view"]>("View", {}),
  });
  const fileMenuHandlers: FileMenuHandler[] = [];
  const workspaceOn = vi.fn();
  workspaceOn.mockImplementation(
    (event: string, handler: FileMenuHandler): EventRef => {
      if (event === "file-menu") fileMenuHandlers.push(handler);
      return stubService<EventRef>("EventRef", {});
    },
  );
  const getLeaf = vi.fn(() => leaf);
  const openPopoutLeaf = vi.fn(() => leaf);
  const workspace = stubService<App["workspace"]>("Workspace", {
    activeLeaf: null,
    rootSplit: stubService<App["workspace"]["rootSplit"]>("WorkspaceRoot", {}),
    getActiveFile: () => file,
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [],
    getLeaf,
    openPopoutLeaf,
    revealLeaf: vi.fn(),
    on: workspaceOn,
    onLayoutReady: vi.fn(),
  });
  const loadLocalStorage = vi.fn<() => unknown>(() => null);
  const saveLocalStorage = vi.fn();
  const app = stubService<App>("App", {
    workspace,
    loadLocalStorage,
    saveLocalStorage,
    vault: stubService<App["vault"]>("Vault", {
      cachedRead: vi.fn(async () => "A document"),
      getFileByPath: vi.fn(() => null),
    }),
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: () => null,
    }),
  });
  const commands: Command[] = [];
  const registerView = vi.fn();
  const plugin = stubService<Plugin>("Plugin", {
    app,
    manifest: stubService<Plugin["manifest"]>("PluginManifest", {
      version: "2.1.3",
    }),
    registerView,
    addCommand: (command: Command) => {
      commands.push(command);
      return command;
    },
    registerEvent: vi.fn(),
    register: vi.fn(),
    registerMarkdownPostProcessor: vi.fn(),
  });
  const deps = stubService<RegistrationHostDeps>("TemplateWorkbenchDeps", {
    runtime: testRuntime(),
    settings: stubService<RegistrationHostDeps["settings"]>("PluginSettings", {
      current: Effect.succeed({
        ...defaults,
        "template.folder": "templates",
      }),
    }),
    bridge: stubService<RegistrationHostDeps["bridge"]>("EffectBridge", {
      runSync: Effect.runSync,
    }),
    profile: stubService<RegistrationHostDeps["profile"]>("Profile", {
      profiles: Effect.succeed([]),
      defaultDocumentPath: Effect.succeed(
        "templates/zotlit-profile.default.md",
      ),
    }),
  });
  return {
    app,
    workspace,
    getLeaf,
    openPopoutLeaf,
    file,
    leaf,
    plugin,
    deps,
    commands,
    fileMenu: (menuLeaf?: WorkspaceLeaf) => {
      const menu = new Menu();
      for (const handler of fileMenuHandlers)
        handler(menu, file, "more-options", menuLeaf);
      return menu;
    },
    registerView,
    setViewState,
    focusWindow,
  };
}

function register(
  plugin: Plugin,
  deps: RegistrationHostDeps,
  notifier?: Notifier["Service"],
): void {
  const options = {
    ...makeWorkbenchHost(deps).deps,
    bridge: testBridge(),
    context: appContext(plugin.app, {
      ...(notifier ? { notifier } : {}),
      profile: deps.profile,
    }),
    defaultProfile: defaultTarget(deps.profile),
  };
  registerTemplateWorkbenchView(plugin, options);
  registerFileMenu(plugin, [templateWorkbenchFileMenu(plugin.app, options)]);
}

describe("Template Workbench entry points", () => {
  it.each([
    ["file", false],
    ["built-in Default", false],
    ["file", true],
    ["built-in Default", true],
  ] as const)(
    "opens a %s no window holds in a new Workbench window (customize: %s)",
    async (target, customize) => {
      const { app, openPopoutLeaf, getLeaf, file, setViewState } = setup();
      await launch(
        app,
        openTemplateWorkbench(target === "file" ? file : builtInDefault, {
          customize,
        }),
      );

      expect(getLeaf).not.toHaveBeenCalled();
      expect(openPopoutLeaf).toHaveBeenCalledWith({
        size: { width: 1440, height: 900 },
      });
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );

  it("shows the Preview of every document it opens, through the window layout", async () => {
    const { app, file, leaf } = setup();
    const view = Object.create(
      TemplateWorkbenchView.prototype,
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view });
    await launch(app, openTemplateWorkbench(file));
    expect(openWorkbenchLayout).toHaveBeenCalledWith(view);
  });

  it("reveals the window that already holds the document instead of opening another", async () => {
    const { app, file, leaf, openPopoutLeaf, getLeaf } = setup();
    const view = Object.assign(Object.create(TemplateWorkbenchView.prototype), {
      file,
      leaf,
    }) as TemplateWorkbenchView;
    Object.assign(leaf, { view });
    vi.mocked(findWorkbenchLayout).mockReturnValue(Effect.succeed(view));
    await launch(app, openTemplateWorkbench(file));
    await launch(app, openTemplateWorkbench(file));
    expect(openPopoutLeaf).not.toHaveBeenCalled();
    expect(getLeaf).not.toHaveBeenCalled();
    expect(openWorkbenchLayout).toHaveBeenLastCalledWith(view);
  });

  it.each(["replace", "tab", "split"] as const)(
    "opens beside a leaf that stands in a Workbench window: %s",
    async (place) => {
      const { app, file, leaf, openPopoutLeaf, getLeaf } = setup();
      const split = vi.fn(() => leaf);
      Object.assign(app.workspace, { createLeafBySplit: split });
      const window = stubService<App["workspace"]["rootSplit"]>(
        "WorkspaceContainer",
        { focus: vi.fn() },
      );
      const fromState = vi.fn(async () => {});
      const from = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        updateHeader: vi.fn(),
        view: stubService<WorkspaceLeaf["view"]>("View", {}),
        setViewState: fromState,
        getContainer: () => window,
      });
      await launch(
        app,
        openTemplateWorkbench(file, { from: { leaf: from, place } }),
      );
      expect(openPopoutLeaf).not.toHaveBeenCalled();
      const made = { replace: fromState, tab: getLeaf, split }[place];
      expect(made).toHaveBeenCalledOnce();
    },
  );

  it("opens a new window for an open that starts in the main window", async () => {
    const { app, file, openPopoutLeaf } = setup();
    const fromState = vi.fn(async () => {});
    const from = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      setViewState: fromState,
      getContainer: () => app.workspace.rootSplit,
    });
    await launch(
      app,
      openTemplateWorkbench(file, { from: { leaf: from, place: "replace" } }),
    );
    expect(fromState).not.toHaveBeenCalled();
    expect(openPopoutLeaf).toHaveBeenCalledOnce();
  });

  it.each(["named", "copied-default", "default"])(
    "applies a Customize launch Item to the existing %s workbench and leaves its compact editor unchanged",
    async (kind) => {
      const {
        app,
        openPopoutLeaf,
        file,
        leaf: compactLeaf,
        setViewState: compactSetState,
      } = setup();
      if (kind === "default") file.path = "templates/zotlit-profile.default.md";
      if (kind !== "named") {
        vi.spyOn(app.vault, "cachedRead").mockResolvedValue(`---
id: default
name: Default
version: 1.0.0
contract: 2
filename: "{{ zt.title }}"
---
Body
--- zotlit:annotation ---
Annotation`);
      }
      const chooseCompactItem = vi.fn();
      const chooseWorkbenchItem = vi.fn();
      const compact = Object.assign(
        Object.create(TemplateWorkbenchView.prototype),
        { file, leaf: compactLeaf, chooseItem: chooseCompactItem },
      ) as TemplateWorkbenchView;
      Object.assign(compactLeaf, { view: compact });
      const workbenchSetState = vi.fn(async () => {});
      const workbenchContainer = stubService<App["workspace"]["rootSplit"]>(
        "WorkspaceContainer",
        { focus: vi.fn() },
      );
      const workbenchLeaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        setViewState: workbenchSetState,
        getContainer: () => workbenchContainer,
      });
      const workbench = Object.assign(
        Object.create(TemplateWorkbenchView.prototype),
        { file, leaf: workbenchLeaf, chooseItem: chooseWorkbenchItem },
      ) as TemplateWorkbenchView;
      Object.assign(workbenchLeaf, { view: workbench });
      vi.spyOn(app.workspace, "getLeavesOfType").mockReturnValue([
        compactLeaf,
        workbenchLeaf,
      ]);
      vi.mocked(findWorkbenchLayout).mockReturnValueOnce(
        Effect.succeed(workbench),
      );
      await launch(
        app,
        openTemplateWorkbench(file, {
          customize: true,
          itemIndexedKey: "MAIN2345",
          originatingNote: file,
        }),
      );
      expect(findWorkbenchLayout).toHaveBeenCalledWith({
        file: file.path,
        defaultProfile: false,
      });
      expect(workbenchSetState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path, itemIndexedKey: "MAIN2345" },
        active: true,
      });
      expect(compactSetState).not.toHaveBeenCalled();
      expect(openPopoutLeaf).not.toHaveBeenCalled();
      expect(openWorkbenchLayout).toHaveBeenLastCalledWith(workbench);
      expect(setOriginatingNote).toHaveBeenLastCalledWith(file);
      expect(chooseWorkbenchItem).not.toHaveBeenCalled();
      expect(chooseCompactItem).not.toHaveBeenCalled();
    },
  );

  it("applies two quick Customize launches into one workbench in the order they came", async () => {
    const { app, file, leaf } = setup();
    const workbench = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file, leaf },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findWorkbenchLayout).mockReturnValue(Effect.succeed(workbench));
    const firstApplied = Promise.withResolvers<void>();
    const applied: unknown[] = [];
    let working = false;
    const setViewState = vi.fn(async ({ state }: ViewState) => {
      if (working) return;
      working = true;
      try {
        if (applied.length === 0) await firstApplied.promise;
        applied.push(state?.itemIndexedKey);
      } finally {
        working = false;
      }
    });
    Object.assign(leaf, { setViewState });
    const note = (basename: string) =>
      Object.assign(new TFile(), {
        path: `literatures/${basename}.md`,
        basename,
      });
    const rougier = note("rougierTenSimpleRules2014");
    const witt = note("wittNebulinRegulatesThin2006");
    setOriginatingNote.mockClear();
    const launches = launch(
      app,
      Effect.all(
        [
          openTemplateWorkbench(file, {
            customize: true,
            itemIndexedKey: "RUGIER24",
            originatingNote: rougier,
          }),
          openTemplateWorkbench(file, {
            customize: true,
            itemIndexedKey: "WTTTNB26",
            originatingNote: witt,
          }),
        ],
        { concurrency: "unbounded" },
      ),
    );
    await vi.waitFor(() => expect(setViewState).toHaveBeenCalled());
    firstApplied.resolve();
    await launches;
    expect(applied).toEqual(["RUGIER24", "WTTTNB26"]);
    expect(setOriginatingNote.mock.calls).toEqual([[rougier], [witt]]);
  });

  it("binds an existing built-in Default workbench to the custom file before applying its launch Item", async () => {
    const { app, file, leaf, setViewState } = setup();
    file.path = "templates/zotlit-profile.default.md";
    const chooseItem = vi.fn();
    const workbench = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file: null, leaf, chooseItem },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: workbench });
    vi.mocked(findWorkbenchLayout).mockReturnValueOnce(
      Effect.succeed(workbench),
    );
    vi.spyOn(app.vault, "getFileByPath").mockReturnValue(file);
    await launch(
      app,
      openTemplateWorkbench(
        defaultTarget({ defaultDocumentPath: Effect.succeed(file.path) }),
        { customize: true, itemIndexedKey: "MAIN2345" },
      ),
    );
    expect(findWorkbenchLayout).toHaveBeenCalledWith({
      file: file.path,
      defaultProfile: true,
    });
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: {
        file: file.path,
        defaultDraft: false,
        itemIndexedKey: "MAIN2345",
      },
      active: true,
    });
    expect(openWorkbenchLayout).toHaveBeenLastCalledWith(workbench);
    expect(chooseItem).not.toHaveBeenCalled();
  });

  it("routes explicit Default customization through the ready inspection view", async () => {
    const { app, leaf, setViewState } = setup();
    const customizeDefault = vi.fn(() => Effect.void);
    Object.assign(leaf, {
      view: Object.assign(Object.create(TemplateWorkbenchView.prototype), {
        customizeDefault,
      }),
    });
    await launch(
      app,
      openTemplateWorkbench(builtInDefault, {
        customize: true,
        itemIndexedKey: "0:ABCDEFGH",
      }),
    );
    expect(setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        state: { file: null, defaultDraft: true, itemIndexedKey: "0:ABCDEFGH" },
      }),
    );
    expect(customizeDefault).toHaveBeenCalledOnce();
  });

  it.each(["file", "built-in Default"])(
    "brings the %s editor window forward after its leaf is ready",
    async (target) => {
      const { app, getLeaf, openPopoutLeaf, file, leaf, focusWindow } = setup();
      const reveal = Promise.withResolvers<void>();
      const revealLeaf = vi
        .spyOn(app.workspace, "revealLeaf")
        .mockReturnValue(reveal.promise);
      const opening = launch(
        app,
        openTemplateWorkbench(target === "file" ? file : builtInDefault),
      );
      await vi.waitFor(() => expect(revealLeaf).toHaveBeenCalledWith(leaf));
      expect(focusWindow).not.toHaveBeenCalled();

      reveal.resolve();
      await opening;

      expect(focusWindow).toHaveBeenCalledOnce();
      expect(getLeaf).not.toHaveBeenCalled();
      expect(openPopoutLeaf).toHaveBeenCalledOnce();
    },
  );

  it("focuses the starting leaf's Workbench window when the open replaces that leaf", async () => {
    const { app, file, focusWindow } = setup();
    const revealLeaf = vi.spyOn(app.workspace, "revealLeaf");
    const focusExistingWindow = vi.fn();
    const existingContainer = stubService<App["workspace"]["rootSplit"]>(
      "WorkspaceContainer",
      { focus: focusExistingWindow },
    );
    const existing = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      updateHeader: vi.fn(),
      view: stubService<WorkspaceLeaf["view"]>("View", {}),
      setViewState: vi.fn(async () => {}),
      getContainer: () => existingContainer,
    });

    await launch(
      app,
      openTemplateWorkbench(file, {
        from: { leaf: existing, place: "replace" },
      }),
    );

    expect(revealLeaf).toHaveBeenCalledWith(existing);
    expect(focusExistingWindow).toHaveBeenCalledOnce();
    expect(focusWindow).not.toHaveBeenCalled();
  });

  it("offers one open on a Profile, from the command and the file menu", () => {
    setMockPlatform({ isDesktopApp: true });
    const { deps, plugin, commands, fileMenu } = setup();

    register(plugin, deps);

    expect(commands.map(({ id }) => id)).toEqual(["open-template-workbench"]);
    expect(commands.map(({ name }) => name)).toEqual([
      m.template_workbench_open_layout(),
    ]);
    expect(fileMenu().items.map(({ title }) => title)).toEqual([
      m.template_workbench_open_layout(),
    ]);
  });

  it.each([
    ["Citation Template", "templates/zotlit-citation.md", "zotlit-citation"],
    [
      "Shared Partial",
      "templates/zotlit-partial.authors.md",
      "zotlit-partial.authors",
    ],
  ])(
    "opens the %s from the command and the file menu, with no Profile flow",
    async (_kind, path, basename) => {
      setMockPlatform({ isDesktopApp: true });
      const { file, deps, plugin, commands, fileMenu, setViewState } = setup();
      file.path = path;
      file.basename = basename;
      register(plugin, deps);

      const command = commands.find(
        (entry) => entry.id === "open-template-workbench",
      )!;
      expect(command.checkCallback?.(true)).toBe(true);
      expect(command.checkCallback?.(false)).toBe(true);
      await vi.waitFor(() =>
        expect(setViewState).toHaveBeenCalledWith(
          expect.objectContaining({
            type: TEMPLATE_WORKBENCH_VIEW_TYPE,
            state: expect.objectContaining({ file: file.path }),
          }),
        ),
      );
      expect(fileMenu().items.map(({ title }) => title)).toEqual([
        m.template_workbench_open_layout(),
      ]);
    },
  );
  it("opens a Profile from its file menu in the Workbench, with no Customize flow", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { file, deps, plugin, fileMenu, openPopoutLeaf, setViewState } =
      setup();
    deps.profile = {
      ...deps.profile,
      defaultDocumentPath: Effect.succeed(file.path),
    };
    register(plugin, deps);

    fileMenu()
      .items.find((item) => item.title === m.template_workbench_open_layout())!
      .click();

    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      }),
    );
    expect(openPopoutLeaf).toHaveBeenCalledOnce();
  });
  it("reveals the active editor's Workbench window from Open template workbench", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, leaf, deps, plugin, commands, openPopoutLeaf } = setup();
    register(plugin, deps);
    const command = commands.find(
      (entry) => entry.id === "open-template-workbench",
    )!;
    expect(command.name).toBe(m.template_workbench_open_layout());
    Object.assign(app.workspace, { getActiveFile: () => null });
    expect(command.checkCallback!(true)).toBe(false);
    const editor = Object.assign(
      Object.create(TemplateWorkbenchView.prototype),
      { file, leaf },
    ) as TemplateWorkbenchView;
    Object.assign(leaf, { view: editor });
    Object.assign(app.workspace, {
      getActiveFile: () => file,
      getActiveViewOfType: () => editor,
    });
    vi.mocked(findWorkbenchLayout).mockReturnValue(Effect.succeed(editor));
    expect(command.checkCallback!(true)).toBe(true);
    command.checkCallback!(false);
    await vi.waitFor(() =>
      expect(openWorkbenchLayout).toHaveBeenCalledWith(editor),
    );
    expect(openPopoutLeaf).not.toHaveBeenCalled();
  });
  it("opens the built-in Default draft's own window from Open template workbench", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, leaf, deps, plugin, commands } = setup();
    register(plugin, deps);
    const draft = Object.create(TemplateWorkbenchView.prototype, {
      file: { value: null },
      leaf: { value: leaf },
      isDefaultDraft: { value: true },
    }) as TemplateWorkbenchView;
    Object.assign(leaf, { view: draft });
    Object.assign(app.workspace, {
      getActiveFile: () => null,
      getActiveViewOfType: () => draft,
    });
    vi.mocked(findWorkbenchLayout).mockReturnValue(Effect.succeed(draft));
    const command = commands.find(
      (entry) => entry.id === "open-template-workbench",
    )!;
    expect(command.checkCallback!(false)).toBe(true);
    await vi.waitFor(() =>
      expect(openWorkbenchLayout).toHaveBeenCalledWith(draft),
    );
  });
  it.each(["command", "file menu"])(
    "opens a Markdown view's Profile from the %s in a Workbench window, leaving the Markdown view in place",
    async (surface) => {
      setMockPlatform({ isDesktopApp: true });
      const {
        app,
        file,
        leaf,
        deps,
        plugin,
        commands,
        fileMenu,
        openPopoutLeaf,
        setViewState,
      } = setup();
      Object.assign(app.workspace, { rootSplit: leaf.getContainer() });
      const markdownView = Object.assign(new MarkdownView(leaf), {
        file,
        leaf,
      });
      Object.assign(leaf, { view: markdownView });
      app.workspace.activeLeaf = leaf;
      const popoutState = vi.fn(async () => {});
      const popout = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
        updateHeader: vi.fn(),
        setViewState: popoutState,
        getContainer: () =>
          stubService<App["workspace"]["rootSplit"]>("WorkspaceContainer", {
            focus: vi.fn(),
          }),
        view: stubService<WorkspaceLeaf["view"]>("View", {}),
      });
      openPopoutLeaf.mockReturnValue(popout);
      register(plugin, deps);

      if (surface === "command")
        commands
          .find((entry) => entry.id === "open-template-workbench")!
          .checkCallback?.(false);
      else
        fileMenu()
          .items.find(
            (item) => item.title === m.template_workbench_open_layout(),
          )!
          .click();

      await vi.waitFor(() =>
        expect(popoutState).toHaveBeenCalledWith({
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: { file: file.path },
          active: true,
        }),
      );
      expect(setViewState).not.toHaveBeenCalled();
    },
  );
  it("switches a Markdown view back to the Workbench in the Workbench window it stands in", async () => {
    setMockPlatform({ isDesktopApp: true });
    const {
      app,
      file,
      leaf,
      deps,
      plugin,
      commands,
      openPopoutLeaf,
      setViewState,
    } = setup();
    const markdownView = Object.assign(new MarkdownView(leaf), { file, leaf });
    Object.assign(leaf, { view: markdownView });
    app.workspace.activeLeaf = leaf;
    register(plugin, deps);

    commands
      .find((entry) => entry.id === "open-template-workbench")!
      .checkCallback?.(false);

    await vi.waitFor(() =>
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      }),
    );
    expect(openPopoutLeaf).not.toHaveBeenCalled();
  });
  it.each(["command", "file menu"])(
    "opens the current Literature Note's resolved Default from the %s with that paper and note",
    async (surface) => {
      setMockPlatform({ isDesktopApp: true });
      const {
        app,
        file,
        leaf,
        deps,
        plugin,
        commands,
        fileMenu,
        openPopoutLeaf,
        setViewState,
      } = setup();
      file.path = "Literature/Figures.md";
      file.basename = "Figures";
      Object.assign(deps, { app });
      vi.spyOn(app.vault, "getFileByPath").mockImplementation((path) =>
        path === file.path ? file : null,
      );
      vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
        frontmatter: { "zotero-key": "PAPER234" },
      });
      deps.profile.profileOf = vi.fn(() =>
        Effect.succeed({
          ok: true,
          profile: { selector: "default" },
        } as Effect.Success<ReturnType<typeof deps.profile.profileOf>>),
      );
      const customizeDefault = vi.fn(() => Effect.void);
      Object.assign(leaf, {
        view: Object.assign(Object.create(TemplateWorkbenchView.prototype), {
          customizeDefault,
        }),
      });
      setOriginatingNote.mockClear();
      register(plugin, deps);
      if (surface === "command")
        commands
          .find((entry) => entry.id === "open-template-workbench")!
          .checkCallback?.(false);
      else
        fileMenu()
          .items.find(
            (item) => item.title === m.template_workbench_open_layout(),
          )!
          .click();
      await vi.waitFor(() =>
        expect(setViewState).toHaveBeenCalledWith({
          type: TEMPLATE_WORKBENCH_VIEW_TYPE,
          state: {
            defaultDraft: true,
            file: null,
            itemIndexedKey: "PAPER234",
          },
          active: true,
        }),
      );
      expect(openPopoutLeaf).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(setOriginatingNote).toHaveBeenCalledWith(file),
      );
      expect(customizeDefault).toHaveBeenCalledOnce();
    },
  );
  it("explains a Literature Note stamped with a Profile the vault no longer holds", async () => {
    setMockPlatform({ isDesktopApp: true });
    const { app, file, deps, plugin, commands, setViewState } = setup();
    file.path = "Literature/Figures.md";
    file.basename = "Figures";
    Object.assign(deps, { app });
    vi.spyOn(app.vault, "getFileByPath").mockImplementation((path) =>
      path === file.path ? file : null,
    );
    vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
      frontmatter: { "zotero-key": "PAPER234" },
    });
    deps.profile.profileOf = vi.fn(() =>
      Effect.succeed({
        ok: false,
        stamped: { stamp: "books" },
      } as unknown as Effect.Success<
        ReturnType<typeof deps.profile.profileOf>
      >),
    );
    const notifier = testNotifier();
    register(plugin, deps, notifier.service);
    const command = commands.find(
      (entry) => entry.id === "open-template-workbench",
    )!;
    expect(command.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() => expect(notifier.notices).toHaveLength(1));
    expect(setViewState).not.toHaveBeenCalled();
  });
  it.each([
    "language: eta",
    "language: liquid\nfrontmatter:\n  - key: title\n    js: zt.title\n    merge: replace",
  ])(
    "opens an advanced Profile in the View without a notice: %s",
    async (manifest) => {
      const { app, file, setViewState } = setup();
      const source = `---\nid: paper\nname: Paper\nversion: 1.0.0\ncontract: 2\n${manifest}\nfilename: paper\n---\nBody\n--- zotlit:annotation ---\nAnnotation\n`;
      vi.spyOn(app.vault, "cachedRead").mockResolvedValue(source);
      expect(await launch(app, openTemplateWorkbench(file))).toEqual({
        unavailableNote: null,
      });
      expect(setViewState).toHaveBeenCalledOnce();
    },
  );
  it.each(["file", "default"])(
    "opens %s without borrowing the active note's Item",
    async (kind) => {
      const { app, file, setViewState } = setup();
      vi.spyOn(app.metadataCache, "getFileCache").mockReturnValue({
        frontmatter: { "zotero-key": "MAIN2345" },
      });
      await launch(
        app,
        openTemplateWorkbench(kind === "file" ? file : builtInDefault),
      );
      expect(setViewState).toHaveBeenCalledWith({
        type: TEMPLATE_WORKBENCH_VIEW_TYPE,
        state:
          kind === "file"
            ? { file: file.path }
            : { defaultDraft: true, file: null },
        active: true,
      });
    },
  );

  it("opens built-in Default as a draft without ejecting it", async () => {
    const { app, setViewState } = setup();
    await launch(app, openTemplateWorkbench(builtInDefault));
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: { defaultDraft: true, file: null },
      active: true,
    });
  });
  it("opens the requested Match tab in Basic mode", async () => {
    const { app, file, setViewState } = setup();
    await launch(app, openTemplateWorkbench(file, { tab: "match" }));
    expect(setViewState).toHaveBeenCalledWith({
      type: TEMPLATE_WORKBENCH_VIEW_TYPE,
      state: { file: file.path, tab: "match", advanced: false },
      active: true,
    });
  });

  it("keeps registration desktop-only", () => {
    setMockPlatform({ isDesktopApp: false });
    const { plugin, deps, registerView } = setup();
    register(plugin, deps);
    expect(registerView).not.toHaveBeenCalled();
  });
});
