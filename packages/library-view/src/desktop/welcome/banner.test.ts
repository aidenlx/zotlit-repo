import type { SettingsFixture } from "#__fixtures__/settings.ts";
import { Layer } from "effect";
import type { App } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { layerHostApp } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import {
  createObsidianHost,
  PluginStub,
} from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
// @vitest-environment happy-dom
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { WelcomeBanner } from "./banner.tsx";
import type { WelcomeBannerDeps } from "./banner.tsx";

import { buildRelease } from "#__fixtures__/release.ts";
import { buildSettings } from "#__fixtures__/settings.ts";
import { makeWelcomeHost } from "#__fixtures__/welcome.ts";
import { Release } from "#obsidian/release/service.ts";

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

async function setup(
  data: Record<string, unknown> = {},
  files: Record<string, string> = {},
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost(files);
  const app = host.app as unknown as App;
  Object.assign(app, { internalPlugins: { getEnabledPluginById: () => null } });
  const plugin = new PluginStub(app, { __VERSION__: 10, ...data });
  const settings = await loadSettings(plugin);
  await settings.bridge.runPromise(settings.loaded);
  const deps = await bannerDeps(app, settings);
  let latest = settings;
  const reload = async () => {
    await latest.bridge.runPromise(latest.flush);
    latest = await loadSettings(plugin);
    await latest.bridge.runPromise(latest.loaded);
    return bannerDeps(app, latest);
  };
  return { deps, host, settings, reload };
}

async function loadSettings(plugin: PluginStub): Promise<SettingsFixture> {
  const identity = (raw: unknown) => raw;
  return cleanup.use(
    await buildSettings({
      plugin,
      migrateLegacy: identity,
      migrateV1: identity,
      migrateV2: identity,
      migrateV3: identity,
      migrateV4: identity,
      migrateV5: identity,
      migrateV6: identity,
      migrateV7: identity,
      migrateV8: identity,
      migrateV9: identity,
      migrateV10: identity,
    }),
  );
}

async function bannerDeps(app: App, settings: SettingsFixture) {
  const release = cleanup.use(
    await buildRelease({
      app,
      layoutReady: () => {},
      current: () => settings.bridge.runSync(settings.current),
      origin: settings.bridge.runSync(settings.hydrationOrigin),
      update: (patch) => {
        settings.bridge.runSync(settings.update(patch));
      },
      version: "2.2.0",
    }),
  );
  const host = cleanup.use(
    await makeWelcomeHost({
      services: Layer.mergeAll(
        layerHostApp(app),
        Layer.succeed(PluginSettings, settings),
        Layer.succeed(Release, release.release),
      ),
    }),
  );
  const deps = {
    registry: host.registry,
    setupActions: {
      openSettings: vi.fn(),
      pickFolder: vi.fn(),
      locateZotero: vi.fn(),
    },
    settings,
    bridge: settings.bridge,
  };
  return deps;
}

async function open(deps: WelcomeBannerDeps) {
  return (await openBanner(deps)).el;
}

async function openBanner(deps: WelcomeBannerDeps) {
  const el = document.body.createDiv();
  const banner = new WelcomeBanner(deps, { searchLibrary: vi.fn() }, el);
  await act(async () => {
    banner.load();
    await banner.settled;
  });
  cleanup.defer(() => banner.unload());
  return { el, banner };
}

const heading = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('[role="heading"]')].some(
    (node) => node.textContent === text,
  );

const helpLink = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll("a")].find(
    (a) =>
      el.ownerDocument.getElementById(a.getAttribute("aria-labelledby") ?? "")
        ?.textContent === name,
  );

function dismissButton(el: HTMLElement): HTMLElement {
  const button = el.querySelector<HTMLElement>("[data-welcome-dismiss]");
  if (!button) throw new Error("No dismiss control");
  return button;
}

it("keeps the Migration Prompt of a v1 upgrade on screen until a dismissal acknowledges it", async () => {
  const { deps, settings } = await setup(
    {
      "welcome.dismissed": true,
      "release.migration-pending": true,
    },
    { "literatures/Paper.md": "", "templates/zt-note.eta.md": "" },
  );
  settings.bridge.runSync(settings.update({ "template.folder": "templates" }));
  const el = await open(deps);
  expect(heading(el, m.welcome_migration_title())).toBe(true);
  expect(heading(el, m.welcome_companion_title())).toBe(true);
  expect(el.textContent).toContain(m.companion_zotero_10_guidance());
  expect(helpLink(el, "Star on GitHub")?.getAttribute("href")).toBe(
    "https://github.com/aidenlx/zotlit",
  );
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(
    settings.bridge.runSync(settings.current)?.["release.migration-pending"],
  ).toBe(false);
});

it("announces an update until What's new acknowledges it, beside the Help Links", async () => {
  const { deps, host, settings } = await setup({
    "welcome.dismissed": true,
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(true);
  expect(helpLink(el, "Getting started")).toBeDefined();
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  cleanup.defer(() => opened.mockRestore());
  const whatsNew = [...el.querySelectorAll("button")].find(
    (button) => button.textContent === m.welcome_update_action(),
  );
  expect(whatsNew).toBeDefined();
  await act(() => whatsNew?.click());
  expect(opened.mock.calls).toEqual([
    ["https://zotlit.aidenlx.site/changelog/2.2.0"],
  ]);
  expect(
    settings.bridge.runSync(settings.current)?.["release.update-pending"],
  ).toBe(false);
  expect(el.textContent).toBe("");
});

it("acknowledges an update on dismissal, so it stays away when the view opens again", async () => {
  const { deps, host, settings } = await setup({
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(true);
  await act(() => dismissButton(el).click());
  expect(el.textContent).toBe("");
  expect(
    settings.bridge.runSync(settings.current)?.["release.update-pending"],
  ).toBe(false);
  expect((await open(deps)).textContent).toBe("");
});

it("keeps the setup steps after What's new while setup is incomplete", async () => {
  const { deps } = await setup({
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
  });
  const el = await open(deps);
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  cleanup.defer(() => opened.mockRestore());
  const whatsNew = [...el.querySelectorAll("button")].find(
    (button) => button.textContent === m.welcome_update_action(),
  );
  expect(whatsNew).toBeDefined();
  await act(() => whatsNew?.click());
  expect(heading(el, m.welcome_update_title({ version: "2.2.0" }))).toBe(false);
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
});

it("announces no update while release notices are off", async () => {
  const { deps, host } = await setup({
    "release.previous-version": "2.2.0",
    "release.update-pending": true,
    "release.notices-enabled": false,
  });
  host.vault.addFile("literatures/Paper.md", "");
  expect((await open(deps)).textContent).toBe("");
});

function stepsToggle(el: HTMLElement): HTMLElement {
  const button = el.querySelector<HTMLElement>(
    "[data-welcome-setup-done] button[aria-expanded]",
  );
  if (!button) throw new Error("No Show steps control");
  return button;
}

it("shows the banner it was asked for again after Obsidian reloads, and keeps it away once dismissed", async () => {
  const { deps, host, settings, reload } = await setup();
  host.vault.addFile("literatures/Paper.md", "");
  const { el, banner } = await openBanner(deps);
  expect(el.textContent).toBe("");
  await act(() => banner.request());
  expect(heading(el, m.welcome_step_folder_title())).toBe(true);
  expect(settings.bridge.runSync(settings.current)?.["welcome.requested"]).toBe(
    true,
  );

  const again = await openBanner(await reload());
  expect(again.banner.shown).toBe(true);
  expect(heading(again.el, m.welcome_step_folder_title())).toBe(true);
  await act(() => dismissButton(again.el).click());
  expect(again.el.textContent).toBe("");

  const last = await openBanner(await reload());
  expect(last.banner.shown).toBe(false);
  expect(last.el.textContent).toBe("");
});

it("keeps Show steps open after Obsidian reloads, until the banner is dismissed", async () => {
  const { deps, host, reload } = await setup({
    "note.template-conversion-pending": true,
  });
  host.vault.addFile("literatures/Paper.md", "");
  const el = await open(deps);
  expect(stepsToggle(el).getAttribute("aria-expanded")).toBe("false");
  await act(() => stepsToggle(el).click());
  expect(stepsToggle(el).getAttribute("aria-expanded")).toBe("true");

  const again = await open(await reload());
  expect(stepsToggle(again).getAttribute("aria-expanded")).toBe("true");
  await act(() => dismissButton(again).click());

  const after = await reload();
  after.bridge.runSync(after.settings.update({ "welcome.dismissed": false }));
  const last = await open(after);
  expect(stepsToggle(last).getAttribute("aria-expanded")).toBe("false");
});

it("reads plugin data of an earlier build, which kept no request, as no request and steps folded", async () => {
  const { deps, host, settings } = await setup({ "welcome.dismissed": false });
  host.vault.addFile("literatures/Paper.md", "");
  expect(settings.bridge.runSync(settings.current)?.["welcome.requested"]).toBe(
    false,
  );
  expect(
    settings.bridge.runSync(settings.current)?.["welcome.steps-shown"],
  ).toBe(false);
  expect((await open(deps)).textContent).toBe("");
});
