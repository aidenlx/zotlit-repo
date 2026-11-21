import type { WorkbenchSuggesterRequest } from "#obsidian/headless-ui/suggester.ts";
// @vitest-environment happy-dom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { SuggestModal } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { createTemplateWorkbenchHost } from "./host.tsx";

import { liquidTemplate } from "#core/language/index.ts";
import {
  NO_MATCH_DATA,
  WorkbenchClipboardError,
  WorkbenchHostError,
} from "#obsidian/headless-ui/index.tsx";
import { chooseWorkbenchOption } from "#obsidian/headless-ui/suggester.ts";

/** How `fiber` ended: its value, or its failure as a rejection. */
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
    await expect(
      settled(host.run(host.copy!("report"))),
    ).rejects.toBeInstanceOf(WorkbenchClipboardError);
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
  it("wears Obsidian's suggestion classes, with the description and type as cells", async () => {
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
          host.editorPopups!(
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
      expect(popup.classList.contains("suggestion-container")).toBe(true);
      expect(document.body.contains(popup)).toBe(true);
      expect(input.contains(popup)).toBe(false);
      const rows = [...popup.querySelectorAll("li")];
      const row = rows.find(
        (row) =>
          row.querySelector(".cm-completionLabel")!.textContent === "title",
      )!;
      expect(
        row.querySelector(".zt-template-completion-type")!.textContent,
      ).toBe("string | null");
      expect(row.querySelector(".suggestion-note")!.textContent).toBe(
        "Item title.",
      );
      const destination = document.implementation.createHTMLDocument();
      destination.body.append(input);
      view.setRoot(destination);
      migrations[0]!({
        document: destination,
      } as Window);
      expect(
        destination.body.querySelector(".cm-tooltip-autocomplete"),
      ).not.toBeNull();
      expect(
        document.body.querySelector(".cm-tooltip-autocomplete"),
      ).toBeNull();
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
  it("draws a suggestion row the way Obsidian's own complex rows read", () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    choose({
      title: "Styles",
      selected: "apa",
      groups: [
        {
          label: "Installed",
          options: [
            { id: "apa", label: "APA", hint: "Author-date" },
            { id: "ieee", label: "IEEE", icon: "search" },
          ],
        },
      ],
    });
    type Row = { id: string; label: string; hint?: string; group: string };
    const modal = open.mock.contexts.at(-1)! as SuggestModal<Row>;
    const rows = (modal.getSuggestions("") as Row[]).map((option) => {
      const el = document.createElement("div");
      modal.renderSuggestion(option, el);
      return el;
    });
    expect(
      rows.map((el) => el.querySelector(".suggestion-title")!.textContent),
    ).toEqual(["APA", "IEEE"]);
    expect(
      rows.map(
        (el) => el.querySelector(".suggestion-note .hint")?.textContent ?? null,
      ),
    ).toEqual(["Author-date", null]);
    // The group takes the Library's two slots: a badge closing the note line
    // on a narrow row, a trailing flair on a wide one.
    expect(
      rows.map((el) => [
        el.querySelector(".suggestion-note .zt-suggestion-flair-inline")!
          .textContent,
        el.querySelector(".zt-suggestion-flair")!.textContent,
      ]),
    ).toEqual([
      ["Installed", "Installed"],
      ["Installed", "Installed"],
    ]);
    expect(
      rows.map((el) =>
        [...el.querySelectorAll(".suggestion-aux .suggestion-flair")].map(
          (flair) => flair.getAttribute("aria-label"),
        ),
      ),
    ).toEqual([[m.modal_profile_current()], []]);
    expect(rows.map((el) => el.getAttribute("aria-current"))).toEqual([
      "true",
      null,
    ]);
    // An action row leads with its icon, in Obsidian's own icon slot.
    expect(
      rows.map((el) =>
        el.firstElementChild!.classList.contains("suggestion-icon"),
      ),
    ).toEqual([false, true]);
  });

  it("highlights the searched text in the title and the hint", () => {
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
    const [row] = modal.getSuggestions("ee") as Row[];
    const el = document.createElement("div");
    modal.renderSuggestion(row!, el);
    expect(
      [...el.querySelectorAll(".suggestion-highlight")].map((match) => [
        match.parentElement!.className,
        match.textContent,
      ]),
    ).toEqual([
      [
        "suggestion-title zt:truncate zt:text-sm zt:leading-tight zt:font-medium",
        "EE",
      ],
      ["hint", "ee"],
    ]);
    // Words may land in different fields, the way the filter read before.
    expect(modal.getSuggestions("installed engineer")).toHaveLength(1);
    expect(modal.getSuggestions("apa")).toHaveLength(0);
  });
});
