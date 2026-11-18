// @vitest-environment happy-dom
import { ButtonComponent } from "obsidian";
import type { App, Workspace } from "obsidian";
import { expect, it, vi } from "vitest";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { importedNoteProfileErrorNotice } from "./batch-import-notices.ts";
import { NoteImportProfileError } from "./service.ts";

it("offers recovery on the Literature Note whose unavailable Profile blocked a new child import", () => {
  using click = vi.spyOn(ButtonComponent.prototype, "onClick");
  using label = vi.spyOn(ButtonComponent.prototype, "setButtonText");
  const trigger = vi.fn();
  const notice = importedNoteProfileErrorNotice(
    NoteImportProfileError.unknown("Missing", {
      path: "Literature/Parent.md",
      imported: false,
    }),
    {
      app: stubService<App>("App", {
        workspace: stubService<Workspace>("Workspace", { trigger }),
      }),
    },
  );
  expect(notice).toBeInstanceOf(DocumentFragment);
  const content = notice as DocumentFragment;
  expect(content.textContent).toContain(
    m.notice_literature_note_profile_unknown({ stamp: "Missing" }),
  );
  expect(label).toHaveBeenCalledWith(m.profile_switch_recovery());
  click.mock.calls[0]![0]({} as MouseEvent);
  expect(trigger).toHaveBeenCalledWith("zotlit:switch-profile", {
    path: "Literature/Parent.md",
  });
});
