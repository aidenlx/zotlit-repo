import { expect, it } from "@effect/vitest";
// @vitest-environment happy-dom
import { Effect, Exit, Fiber, Layer } from "effect";
import { TFile } from "obsidian";
import type { App, Command } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { PluginHostShape } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  addCitationTemplateActions,
  openCitationTemplate,
  reportCitationTemplateOpen,
} from "./actions.ts";
import { Template, templateFailure } from "./service.ts";
import type { TemplateFailure } from "./service.ts";
import { TemplateWorkbenchLauncher } from "./workbench-launcher.ts";
import type { TemplateWorkbenchLaunch } from "./workbench-launcher.ts";

const CITATION = Object.assign(new TFile(), {
  path: "Templates/zotlit-citation.md",
});

function workspaceApp() {
  const opened: {
    path: string;
    options: TemplateWorkbenchLaunch | undefined;
  }[] = [];
  const workspace = Layer.succeed(
    TemplateWorkbenchLauncher,
    TemplateWorkbenchLauncher.of({
      open: (file, options) =>
        Effect.sync(() => {
          opened.push({ path: file.path, options });
        }),
    }),
  );
  return { app: stubService<App>("App", {}), opened, workspace };
}

const servicesOver = (
  materializeCitationTemplate: Effect.Effect<TFile, TemplateFailure>,
  notifier: Notifier["Service"] = testNotifier().service,
  workspace = workspaceApp().workspace,
) =>
  Layer.mergeAll(
    Layer.mock(Template, { materializeCitationTemplate }),
    Layer.succeed(Notifier, notifier),
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
      Template | Notifier | TemplateWorkbenchLauncher
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

      expect(opened).toEqual([{ path: CITATION.path, options: {} }]);
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
