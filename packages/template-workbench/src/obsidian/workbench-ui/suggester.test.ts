// @vitest-environment happy-dom
import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { SuggestModal } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { chooseWorkbenchOption } from "./suggester.ts";
import type { WorkbenchSuggesterRequest } from "./suggester.ts";

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

/** A pop-out window the leaf sits in, apart from the window that has focus. */
const popout = {
  document: document.implementation.createHTMLDocument("Pop-out"),
} as unknown as Window;

const app = stubService<App>("App", {});
const run = Effect.runFork;
const choose = (request: WorkbenchSuggesterRequest) =>
  run(chooseWorkbenchOption(app, request));

describe("Workbench chooser", () => {
  it("keeps the latest item search when an earlier query finishes last", async () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    const first = Promise.withResolvers<{ id: string; label: string }[]>();
    const second = Promise.withResolvers<{ id: string; label: string }[]>();
    choose({
      title: "Items",
      groups: [],
      search: {
        run,
        items: vi
          .fn()
          .mockReturnValueOnce(Effect.promise(() => first.promise))
          .mockReturnValueOnce(Effect.promise(() => second.promise)),
      },
    });
    const modal = open.mock.contexts.at(-1)! as SuggestModal<unknown>;
    const older = modal.getSuggestions("roug");
    const newer = modal.getSuggestions("ioannidis");
    second.resolve([]);
    await newer;
    first.resolve([{ id: "stale", label: "Rougier" }]);
    await expect(older).resolves.toEqual([]);
    modal.close();
  });

  // The chooser kept an earlier query's rows on screen until the typed
  // query's answer arrived, and Enter or a click chose from them.
  it("chooses the first item of the typed query's answer when Enter comes before it", async () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    const figures = { id: "DMRGRART", label: "Ten simple rules" };
    const rules = { id: "RUGIER24", label: "Ten simple rules" };
    const typed = Promise.withResolvers<(typeof rules)[]>();
    const chosen = choose({
      title: "Items",
      groups: [],
      search: {
        run,
        items: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed([figures, rules]))
          .mockReturnValueOnce(Effect.promise(() => typed.promise)),
      },
    });
    const modal = open.mock.contexts.at(-1)! as SuggestModal<unknown>;
    const [earlier] = await modal.getSuggestions("ten");
    void modal.getSuggestions("ten simple rules");

    modal.selectSuggestion(earlier, { type: "click" } as MouseEvent);
    modal.selectSuggestion(earlier, { type: "keydown" } as KeyboardEvent);
    typed.resolve([rules, figures]);

    await expect(settled(chosen)).resolves.toBe("RUGIER24");
  });

  it("waits on Enter before the first item answer, while the list has no row", async () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    const rules = { id: "RUGIER24", label: "Ten simple rules" };
    const typed = Promise.withResolvers<(typeof rules)[]>();
    const chosen = choose({
      title: "Items",
      groups: [],
      search: {
        run,
        items: vi.fn().mockReturnValueOnce(Effect.promise(() => typed.promise)),
      },
    });
    const modal = open.mock.contexts.at(-1)! as SuggestModal<unknown>;
    void modal.getSuggestions("ten simple rules");

    // Enter through the modal's own key scope, as Obsidian's keymap sends it.
    const { handlers } = modal.scope as unknown as {
      handlers: {
        modifiers: string[] | null;
        key: string | null;
        func: (evt: KeyboardEvent) => unknown;
      }[];
    };
    handlers
      .find((h) => h.key === "Enter" && h.modifiers?.length === 0)!
      .func({ type: "keydown", key: "Enter" } as KeyboardEvent);
    typed.resolve([rules]);

    await expect(settled(chosen)).resolves.toBe("RUGIER24");
  });

  it("settles SuggestModal cancellation and restores control focus", async () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    const anchor = document.createElement("button");
    document.body.append(anchor);
    const chosen = choose({
      title: "Styles",
      anchor,
      groups: [
        {
          label: "Installed",
          options: [{ id: "apa", label: "APA", hint: "Author-date" }],
        },
      ],
    });
    const modal = open.mock.contexts.at(-1)! as SuggestModal<unknown>;
    expect(modal.getSuggestions("author")).toEqual([
      { id: "apa", label: "APA", hint: "Author-date", group: "Installed" },
    ]);
    modal.close();
    await expect(settled(chosen)).resolves.toBeNull();
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  // Obsidian opens a modal in the window that last took focus, which can be
  // the main window while the reader works in a pop-out.
  it("opens in the window of the control that asked, or of the view that asked", () => {
    using suggest = vi.spyOn(SuggestModal.prototype, "open");
    const focused = { activeWindow, activeDocument };
    activeWindow = window;
    try {
      choose({ title: "Choose item", groups: [], window: popout });
      const anchor = popout.document.createElement("button");
      Object.defineProperty(anchor.ownerDocument, "defaultView", {
        value: popout,
      });
      choose({ title: "Choose item", groups: [], anchor });
      expect(
        suggest.mock.contexts.map(
          (modal) => (modal as SuggestModal<unknown>).win === popout,
        ),
      ).toEqual([true, true]);
    } finally {
      ({ activeWindow, activeDocument } = focused);
    }
  });

  it("closes the chooser when its Effect is interrupted", () => {
    using open = vi.spyOn(SuggestModal.prototype, "open");
    using close = vi.spyOn(SuggestModal.prototype, "close");
    const fiber = choose({ title: "Styles", groups: [] });
    expect(open).toHaveBeenCalledOnce();

    fiber.interruptUnsafe();

    expect(close).toHaveBeenCalledOnce();
  });
});
