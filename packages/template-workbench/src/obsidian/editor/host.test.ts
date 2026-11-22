import type { WorkbenchSuggesterRequest } from "#obsidian/workbench-ui/suggester.ts";
// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { SuggestModal } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { createTemplateWorkbenchHost } from "./host.tsx";

import { liquidTemplate } from "#core/language/index.ts";
import {
  NO_MATCH_DATA,
  WorkbenchClipboardError,
  WorkbenchHostError,
} from "#obsidian/workbench-ui/index.tsx";
import { chooseWorkbenchOption } from "#obsidian/workbench-ui/suggester.ts";

function settled<A, E>(fiber: Fiber.Fiber<A, E>): Promise<A> {
  return new Promise((resolve, reject) =>
    fiber.addObserver((exit) => {
      if (Exit.isSuccess(exit)) return resolve(exit.value);
      const failure = Cause.squash(exit.cause);
      return reject(
        failure instanceof Error
          ? failure
          : new Error(String(failure), { cause: failure }),
      );
    }),
  );
}

function setup() {
  const memory = new Map<string, string | null>();
  const app = stubService<App>("App", {
    loadLocalStorage: (key: string) => memory.get(key),
    saveLocalStorage: (key: string, value: string | null) =>
      memory.set(key, value),
  });
  const host = createTemplateWorkbenchHost(app, {
    run: Effect.runFork,
    render: () =>
      Effect.fail(
        new WorkbenchHostError({
          cause: new Error("This test renders nothing."),
        }),
      ),
    matchData: NO_MATCH_DATA,
    insertTarget: () => null,
  });
  return { host, memory };
}

describe("Template Workbench host", () => {
  it("names a refused clipboard by its tag", async () => {
    const { host } = setup();
    using _write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("Denied"));
    await expect(settled(host.run(host.copy("report")))).rejects.toBeInstanceOf(
      WorkbenchClipboardError,
    );
  });

  it("keeps preferences in Obsidian's vault-local storage", () => {
    const { host, memory } = setup();
    host.persistence.write("vault", "last", "ABCD2345");
    expect(memory.get("zotlit.workbench.vault.last")).toBe("ABCD2345");
    expect(host.persistence.read("vault", "last")).toBe("ABCD2345");
    host.persistence.write("vault", "last", null);
    expect(host.persistence.read("vault", "last")).toBeNull();
  });
});

describe("Template Workbench typing popup", () => {
  it("opens outside the clipping editor and moves with the editor to a new window", async () => {
    const { host } = setup();
    const input = document.createElement("div");
    const migrations: ((win: Window) => void)[] = [];
    const disposeMigration = vi.fn();
    input.onWindowMigrated = (listener) => {
      migrations.push(listener);
      return disposeMigration;
    };
    input.style.overflow = "hidden";
    document.body.append(input);
    const view = new EditorView({
      state: EditorState.create({
        doc: "{{ zt.",
        extensions: [
          liquidTemplate,
          host.editorPopups(
            () => ({
              root: "note",
              partials: [],
              fields: [{ path: "title", label: "Title" }],
            }),
            input,
          ),
        ],
      }),
      parent: input,
    });
    try {
      view.dispatch({
        changes: { from: 6, insert: "t" },
        selection: { anchor: 7 },
        userEvent: "input.type",
      });
      const popup = await vi.waitFor(() => {
        const found = document.body.querySelector(".cm-tooltip-autocomplete");
        if (!found) throw new Error("no popup yet");
        return found;
      });
      expect(input.contains(popup)).toBe(false);
      expect(popup.textContent).toContain("Item title.");
      const destination = document.implementation.createHTMLDocument();
      destination.body.append(input);
      view.setRoot(destination);
      migrations[0]!({
        document: destination,
      } as Window);
      expect(destination.body.contains(popup)).toBe(true);
      expect(document.body.contains(popup)).toBe(false);
    } finally {
      view.destroy();
      expect(disposeMigration).toHaveBeenCalledOnce();
      input.remove();
    }
  });
});

const app = stubService<App>("App", {});
const choose = (request: WorkbenchSuggesterRequest) =>
  Effect.runFork(chooseWorkbenchOption(app, request));

describe("Workbench chooser rows", () => {
  it("finds an option by words that land in different fields", () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    choose({
      title: "Styles",
      groups: [
        {
          label: "Installed",
          options: [{ id: "ieee", label: "IEEE", hint: "Engineering" }],
        },
      ],
    });
    type Row = { id: string; label: string; hint?: string; group: string };
    const modal = open.mock.contexts.at(-1)! as SuggestModal<Row>;
    expect(modal.getSuggestions("ee")).toHaveLength(1);
    expect(modal.getSuggestions("installed engineer")).toHaveLength(1);
    expect(modal.getSuggestions("apa")).toHaveLength(0);
  });
});
