import { Effect, Layer } from "effect";
import type { App, Workspace, WorkspaceLeaf } from "obsidian";
import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { ObsidianOpenableAttachment } from "@zotlit/annotations/core/attachment-open/resolve.ts";
import { ZotlitPdfReader } from "@zotlit/annotations/obsidian/pdf-reader/service.ts";
import { defaults } from "@zotlit/notes/__fixtures__/settings.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { pdfReader } from "./pdf-reader.ts";
import { ANNOT_VIEW_TYPE } from "./view.tsx";

const ATTACHMENT: ObsidianOpenableAttachment = {
  indexedKey: "ATCH2345",
  label: "Doe 2024.pdf",
  openPath: "Doe 2024.pdf",
  absolutePath: "/vault/Doe 2024.pdf",
};

function appWithSidebar() {
  const sidebar = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  const revealed: WorkspaceLeaf[] = [];
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getLeaf: () =>
        stubService<WorkspaceLeaf>("WorkspaceLeaf", {
          openFile: () => Promise.resolve(),
        }),
      getLeavesOfType: (type) => (type === ANNOT_VIEW_TYPE ? [sidebar] : []),
      revealLeaf: (leaf) => {
        revealed.push(leaf);
        return Promise.resolve();
      },
    }),
  });
  return { app, sidebar, revealed };
}

describe("pdfReader", () => {
  async function openWith(app: App, settings: Settings = defaults) {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const reader = yield* pdfReader;
        return yield* reader.open(ATTACHMENT, false);
      }).pipe(
        Effect.provideService(ObsidianApp, app),
        Effect.provideService(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: Effect.succeed(settings),
          }),
        ),
        Effect.provideService(
          ZotlitPdfReader,
          stubService<ZotlitPdfReader["Service"]>("ZotlitPdfReader", {
            open: () => Effect.succeed("opened"),
          }),
        ),
        Effect.provide(
          Layer.mock(Vault, {
            getFileByPath: () => Effect.succeed(new TFile()),
          }),
        ),
      ),
    );
    expect(outcome).toBe("opened");
  }

  it("brings the annotation view forward beside the PDF by default", async () => {
    const { app, sidebar, revealed } = appWithSidebar();

    await openWith(app);

    await vi.waitFor(() => expect(revealed).toStrictEqual([sidebar]));
  });

  it("leaves the sidebar alone once the user turns the reveal off", async () => {
    const { app, revealed } = appWithSidebar();

    await openWith(app, { ...defaults, "reader.focus-annot-view": false });

    expect(revealed).toStrictEqual([]);
  });
});
