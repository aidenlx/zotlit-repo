// @vitest-environment happy-dom
import type { App, Workspace } from "obsidian";
import { expect, it, vi } from "vitest";

import { noticeContentOf } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { importedNoteProfileErrorNotice } from "./batch-import-notices.ts";
import { NoteImportProfileError } from "./service.ts";

it("offers recovery on the Literature Note whose unavailable Profile blocked a new child import", () => {
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
  const content = noticeContentOf(notice);
  expect(noticeText(content)).toContain(
    m.notice_literature_note_profile_unknown({ stamp: "Missing" }),
  );
  const [action] = content.actions ?? [];
  expect(action?.label).toBe(m.profile_switch_recovery());
  action?.run();
  expect(trigger).toHaveBeenCalledWith("zotlit:switch-profile", {
    path: "Literature/Parent.md",
  });
});
