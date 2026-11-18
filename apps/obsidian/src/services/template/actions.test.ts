import { expect, it } from "@effect/vitest";
// @vitest-environment happy-dom
import { Effect, Exit, Fiber, Layer } from "effect";
import { TFile } from "obsidian";
import type {
  App,
  Command,
  WorkspaceContainer,
  WorkspaceLeaf,
  WorkspaceRoot,
} from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { PluginHostShape } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Profile } from "@/services/profile/service.ts";
import { TEMPLATE_WORKBENCH_VIEW_TYPE } from "@/views/template-workbench/view.tsx";

import {
  addCitationTemplateActions,
  openCitationTemplate,
  reportCitationTemplateOpen,
} from "./actions.ts";
import { Template, templateFailure } from "./service.ts";
import type { TemplateFailure } from "./service.ts";

const CITATION = Object.assign(new TFile(), {
  path: "Templates/zotlit-citation.md",
});

/** An App whose workspace records each view state the open sets. */
function workspaceApp() {
  const opened: { type: string; path: unknown }[] = [];
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    setViewState: async (state: { type: string; state: { file: unknown } }) => {
      opened.push({ type: state.type, path: state.state.file });
    },
    getContainer: () =>
      stubService<WorkspaceContainer>("WorkspaceContainer", {
        focus: () => {},
      }),
    view: stubService<WorkspaceLeaf["view"]>("View", {}),
  });
  // No Workbench is open, so the open takes a new window: `leaf`.
  const workspace = Layer.mock(Workspace, {
    leavesOfType: () => Effect.succeed([]),
    rootSplit: Effect.succeed(stubService<WorkspaceRoot>("WorkspaceRoot", {})),
    openPopoutLeaf: () => Effect.succeed(leaf),
    revealLeaf: () => Effect.void,
  });
  return { app: stubService<App>("App", {}), opened, workspace };
}

/** The Template, Notifier and workspace the open reads. */
const servicesOver = (
  materializeCitationTemplate: Effect.Effect<TFile, TemplateFailure>,
  notifier: Notifier["Service"] = testNotifier().service,
  workspace = workspaceApp().workspace,
) =>
  Layer.mergeAll(
    Layer.mock(Template, { materializeCitationTemplate }),
    Layer.succeed(Notifier, notifier),
    Layer.mock(Vault, {}),
    Layer.mock(Profile, {}),
    workspace,
  );

const failure = templateFailure(new Error("the template folder is a file"));

it.effect("registers Customize citation text as a command", () =>
  Effect.gen(function* () {
    const commands: Command[] = [];
    const host = stubService<Pick<PluginHostShape, "addCommand" | "app">>(
      "PluginHost",
      {
        addCommand: (command: Command) =>
          Effect.sync(() => {
            commands.push(command);
            return command;
          }),
        app: workspaceApp().app,
      },
    );
    const context = yield* Effect.context<
      Template | Notifier | Vault | Workspace | Profile
    >().pipe(Effect.provide(servicesOver(Effect.succeed(CITATION))));
    yield* addCitationTemplateActions(host, {
      context,
      bridge: yield* scopedBridge,
    });
    expect(commands).toMatchObject([
      {
        id: "customize-citation-text",
        name: m.command_customize_citation_text_name(),
      },
    ]);
  }),
);

it.effect(
  "materializes the document, then opens it in the Template Workbench View",
  () =>
    Effect.gen(function* () {
      const { opened, workspace } = workspaceApp();

      yield* openCitationTemplate().pipe(
        Effect.provide(
          servicesOver(Effect.succeed(CITATION), undefined, workspace),
        ),
      );

      expect(opened).toEqual([
        { type: TEMPLATE_WORKBENCH_VIEW_TYPE, path: CITATION.path },
      ]);
    }),
);

it.effect("fails with the Template failure and opens nothing", () =>
  Effect.gen(function* () {
    const { opened } = workspaceApp();

    const error = yield* openCitationTemplate().pipe(
      Effect.provide(servicesOver(Effect.fail(failure))),
      Effect.flip,
    );

    expect(error).toBe(failure);
    expect(opened).toEqual([]);
  }),
);

it.effect("opens nothing once interrupted", () =>
  Effect.gen(function* () {
    const { opened } = workspaceApp();

    const fiber = yield* openCitationTemplate().pipe(
      Effect.provide(servicesOver(Effect.never)),
      Effect.forkChild,
    );
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);

    expect(Exit.hasInterrupts(exit)).toBe(true);
    expect(opened).toEqual([]);
  }),
);

it.effect(
  "reports a failed open as a notice, and an interrupted one as none",
  () =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const report = (materialize: Effect.Effect<TFile, TemplateFailure>) =>
        reportCitationTemplateOpen().pipe(
          Effect.provide(servicesOver(materialize, notifier.service)),
        );

      yield* report(Effect.fail(failure));
      const interrupted = yield* Effect.exit(report(Effect.interrupt));

      expect(notifier.notices.map((notice) => notice.messages)).toEqual([
        [m.notice_citation_text_open_failed()],
      ]);
      expect(Exit.hasInterrupts(interrupted)).toBe(true);
    }),
);
