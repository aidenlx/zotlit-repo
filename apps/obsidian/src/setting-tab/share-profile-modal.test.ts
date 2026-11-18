// @vitest-environment happy-dom
// The Profiles page of the settings tab opens the Share dialog of the notes
// feature from each Profile's row.
import { it as effectIt } from "@effect/vitest";
import { Effect } from "effect";
import { expect, vi } from "vitest";

import { profileServiceFixture } from "@zotlit/notes/__fixtures__/profile/service.ts";
import { ShareProfileModal } from "@zotlit/notes/obsidian/profile/share-profile-modal.ts";
import {
  ExtraButtonComponent,
  Menu,
  Modal,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { scopedSettingTab } from "./__fixtures__.ts";
import type { SettingTabContext } from "./context.ts";
import { profilesPage } from "./profiles.ts";

const id = "Bk3Qn7XvT2Lp" as ProfileId;
const source = `---
id: ${id}
name: Books
version: 1.2.3
contract: 2
filename: "{{ zt.title }}"
author: First author
description: Reading notes
folder: Books
importFolder: Imported
---
{% managed %}{% render "summary" %}{% endmanaged %}
--- zotlit:annotation ---\nAnnotation`;

effectIt.effect.each(["default", id] as const)(
  "opens Share from the %s settings row",
  (selector) =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source,
            "templates/zotlit-partial.summary.md": "Shared summary",
          }),
        ),
      );
      const opened = yield* Effect.acquireDisposable(
        Effect.sync(() => vi.spyOn(Modal.prototype, "open")),
      );
      const services = yield* Effect.promise(() => f.runtime.context());
      const page = profilesPage(
        stubService<SettingTabContext>("SettingTabContext", {
          tab: (yield* scopedSettingTab(services)).tab,
          app: f.app,
        }),
      );
      const label =
        selector === "default" ? m.settings_profile_default_name() : "Books";
      // Default sits on the page itself; every other Profile is a list row.
      const rows = page.items!.flatMap((item) =>
        "type" in item && item.type === "list" ? (item.items ?? []) : [item],
      );
      const row = rows.find((item) => "name" in item && item.name === label);
      if (!row) throw new Error("Profile row missing");
      const setting = renderRow(row);
      const more = setting.components
        .filter((control) => control instanceof ExtraButtonComponent)
        .find((button) => button.tooltip === m.workbench_more_actions())!;
      Object.assign(more, {
        extraSettingsEl: document.createElement("button"),
      });
      more.click();
      Menu.instances
        .at(-1)!
        .items.find((item) => item.title === m.settings_profile_share())!
        .click();
      yield* eventually(() => expect(opened).toHaveBeenCalledOnce());
      const modal = Modal.instances.at(-1)!;
      expect(modal).toBeInstanceOf(ShareProfileModal);
      modal.onOpen();
      expect(modal.title).toBe(m.profile_share_title({ label }));
      modal.onClose();
    }),
);
