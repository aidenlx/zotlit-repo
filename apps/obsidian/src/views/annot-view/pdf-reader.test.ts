import { Effect } from "effect";
import { TFile } from "obsidian";
import type { App, Vault, Workspace, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import type { ObsidianOpenableAttachment } from "@zotlit/annotations/core/attachment-open/resolve.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { defaults } from "@/services/settings/schema.ts";

import { pdfReader } from "./pdf-reader.ts";
import { ANNOT_VIEW_TYPE } from "./view.tsx";

const ATTACHMENT: ObsidianOpenableAttachment = {
  indexedKey: "ATCH2345",
  label: "Doe 2024.pdf",
  openPath: "Doe 2024.pdf",
  absolutePath: "/vault/Doe 2024.pdf",
};

/**
 * An App that opens every file in a fresh leaf and holds one Annotation View
 * in the sidebar; `revealed` records the leaves the workspace brought forward.
 */
function appWithSidebar() {
  const sidebar = stubService<WorkspaceLeaf>("WorkspaceLeaf", {});
  const revealed: WorkspaceLeaf[] = [];
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", {
      getFileByPath: () => new TFile(),
    }),
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
  /** Open one Attachment through the reader the settings configure. */
  async function openWith(app: App, settings: Settings = defaults) {
    const reader = Effect.runSync(
      pdfReader.pipe(
        Effect.provideService(ObsidianApp, app),
        Effect.provideService(
          PluginSettings,
          stubService<PluginSettings["Service"]>("PluginSettings", {
            current: Effect.succeed(settings),
          }),
        ),
      ),
    );
    expect(await reader.open(ATTACHMENT, false)).toBe("opened");
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
