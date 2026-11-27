// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import type {
  WorkspaceContainer,
  WorkspaceLeaf,
  WorkspaceRoot,
} from "obsidian";

import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { layerTemplateWorkbenchLauncher } from "./open.ts";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "./view.tsx";

const CITATION = Object.assign(new TFile(), {
  path: "Templates/zotlit-citation.md",
});

it.effect("opens a launched document in a Template Workbench View", () =>
  Effect.gen(function* () {
    const opened: { type: string; path: unknown }[] = [];
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      setViewState: async (state: {
        type: string;
        state: { file: unknown };
      }) => {
        opened.push({ type: state.type, path: state.state.file });
      },
      getContainer: () =>
        stubService<WorkspaceContainer>("WorkspaceContainer", {
          focus: () => {},
        }),
      view: stubService<WorkspaceLeaf["view"]>("View", {}),
    });
    const workspace = Layer.mock(Workspace, {
      leavesOfType: () => Effect.succeed([]),
      rootSplit: Effect.succeed(
        stubService<WorkspaceRoot>("WorkspaceRoot", {}),
      ),
      openPopoutLeaf: () => Effect.succeed(leaf),
      revealLeaf: () => Effect.void,
    });
    const notifier = testNotifier();
    const launcher = yield* Effect.service(TemplateWorkbenchLauncher).pipe(
      Effect.provide(
        layerTemplateWorkbenchLauncher.pipe(
          Layer.provide(
            Layer.mergeAll(
              workspace,
              Layer.mock(Vault, {}),
              Layer.mock(Profile, {}),
              Layer.succeed(Notifier, notifier.service),
            ),
          ),
        ),
      ),
    );

    yield* launcher.open(CITATION);

    expect(opened).toEqual([
      { type: TEMPLATE_WORKBENCH_VIEW_TYPE, path: CITATION.path },
    ]);
    expect(notifier.notices).toEqual([]);
  }),
);
