import type { WorkbenchHostDeps } from "#__fixtures__/view.ts";
import { Effect, Exit, Stream } from "effect";
import type { TFile } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { beforeEach, expect, it, vi } from "vitest";

import { exitOf } from "@zotlit/obsidian-kit/__fixtures__/view-runner.ts";
// @vitest-environment happy-dom
import {
  ButtonComponent,
  Modal,
  TextComponent,
  controlsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { makeViewRunner } from "@zotlit/obsidian-kit/view-runner.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { CreateSharedPartialOptions } from "./new-partial.ts";
import type { SharedPartialActions } from "./new-partial.ts";

import { makeWorkbenchHost } from "#__fixtures__/view.ts";
import { openTemplateWorkbench } from "#desktop/view/open.ts";
import { createSharedPartialEffect } from "#desktop/view/partial-command.ts";

vi.mock("#desktop/view/open.ts", () => ({
  openTemplateWorkbench: vi.fn(() => Effect.void),
}));

/** The Workbench leaf a create starts from. */
const origin = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
  updateHeader: vi.fn(),
});
const app = stubService<App>("App", {
  workspace: stubService<App["workspace"]>("Workspace", {}),
});

function actions(taken: readonly string[] = []) {
  return {
    getPartialNames: () => taken,
    createPartial: vi.fn(async (name: string) =>
      stubService<TFile>("TFile", {
        path: `templates/zotlit-partial.${name}.md`,
      }),
    ),
  } satisfies SharedPartialActions;
}

function partialFlow(
  app: App,
  template: SharedPartialActions,
  options: CreateSharedPartialOptions = {},
) {
  const host = makeWorkbenchHost({
    app,
    templates: stubService<WorkbenchHostDeps["templates"]>("Template", {
      ...template,
      loaded: true,
      getPartialDocuments: () => [],
      "compile-status-changed": Stream.empty,
    }),
  });
  const runner = makeViewRunner(host.registry);
  host.own(async () => await runner[Symbol.asyncDispose]());
  const exit = exitOf(runner.run(createSharedPartialEffect(app, options)));
  return {
    result: exit.then((exit) => valueOr(exit, null)),
    exit,
    close: async () => await runner[Symbol.asyncDispose](),
  };
}
const createSharedPartial = (
  app: App,
  template: SharedPartialActions,
  options: CreateSharedPartialOptions = {},
) => partialFlow(app, template, options).result;

/** The prompt the flow opened, with its body built. */
async function prompt(): Promise<Modal> {
  await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
  const modal = Modal.instances[0]!;
  modal.onOpen();
  return modal;
}

function nameField(modal: Modal): TextComponent {
  return [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
    .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
    .find((control) => control instanceof TextComponent)!;
}

function button(modal: Modal, text: string): ButtonComponent {
  return controlsOf(
    modal.modalEl.querySelector<HTMLElement>(".modal-button-container")!,
  ).find(
    (control) => control instanceof ButtonComponent && control.text === text,
  ) as ButtonComponent;
}

beforeEach(() => {
  Modal.instances.length = 0;
  vi.mocked(openTemplateWorkbench).mockClear();
});

it("folds the typed name, names the file, and opens the partial in a split", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, {
    name: "Venue line",
    from: origin,
  });
  const modal = await prompt();

  // The completion's query arrives folded, and the row names the file it makes.
  expect(nameField(modal).getValue()).toBe("Venue line");
  expect(modal.contentEl.textContent).toContain(
    m.partial_new_file({ file: "zotlit-partial.venue-line.md" }),
  );

  button(modal, m.partial_new_action()).click();
  modal.onClose();

  await expect(flow).resolves.toBe("venue-line");
  expect(template.createPartial).toHaveBeenCalledWith("venue-line", {});
  expect(openTemplateWorkbench).toHaveBeenCalledWith(
    { path: "templates/zotlit-partial.venue-line.md" },
    { explainUnsupported: false, from: { leaf: origin, place: "split" } },
  );
});

it.each([
  ["annotation", (name: string) => m.partial_name_reserved({ name })],
  ["citation", (name: string) => m.partial_name_reserved({ name })],
  ["authors", (name: string) => m.partial_name_duplicate({ name })],
  ["venue.line", () => m.partial_name_characters()],
])("refuses %s with a message and creates nothing", async (typed, message) => {
  const template = actions(["authors"]);
  const flow = createSharedPartial(app, template, {});
  const modal = await prompt();

  nameField(modal).type(typed);
  expect(modal.contentEl.textContent).toContain(message(typed));

  // Create is refused, so the prompt stays up for a correction.
  button(modal, m.partial_new_action()).click();
  expect(template.createPartial).not.toHaveBeenCalled();
  expect(modal.isOpen).toBe(true);

  modal.onClose();
  await expect(flow).resolves.toBeNull();
});

it("leaves the workspace alone when the caller opens nothing", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, {
    name: "authors",
    source: "{{ zt.authors }}",
    language: "eta",
    open: false,
  });
  const modal = await prompt();
  button(modal, m.partial_new_action()).click();
  modal.onClose();

  await expect(flow).resolves.toBe("authors");
  expect(template.createPartial).toHaveBeenCalledWith("authors", {
    source: "{{ zt.authors }}",
    language: "eta",
  });
  expect(openTemplateWorkbench).not.toHaveBeenCalled();
});

it("answers null when the reader dismisses the prompt", async () => {
  const template = actions();
  const flow = createSharedPartial(app, template, {});
  const modal = await prompt();
  modal.onClose();

  await expect(flow).resolves.toBeNull();
  expect(template.createPartial).not.toHaveBeenCalled();
});

it("closes the name prompt when its Workbench closes", async () => {
  const template = actions();
  const flow = partialFlow(app, template);
  const modal = await prompt();
  await flow.close();
  await vi.waitFor(() => expect(modal.isOpen).toBe(false));
  expect(template.createPartial).not.toHaveBeenCalled();
  expect(Exit.hasInterrupts(await flow.exit)).toBe(true);
});
