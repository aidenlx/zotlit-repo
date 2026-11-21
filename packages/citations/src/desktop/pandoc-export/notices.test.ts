// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ButtonComponent,
  controlsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { engineMissingMessage } from "./notices.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the notice of an export that gets no engine", () => {
  it.each([
    [
      "pack-outdated",
      m.settings_resource_pack_status_pack_outdated,
      "obsidian://show-plugin?id=zotlit-resources",
    ],
    [
      "plugin-outdated",
      m.settings_resource_pack_status_plugin_outdated,
      "obsidian://show-plugin?id=zotlit",
    ],
  ] as const)(
    "names the plugin to update for %s and opens its page",
    (kind, sentence, page) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      const notice = engineMissingMessage({ kind });
      const action = Array.from(notice.querySelectorAll<HTMLElement>("*"))
        .flatMap(controlsOf)
        .find((control) => control instanceof ButtonComponent);

      expect(notice.textContent).toBe(
        m.notice_pandoc_export_engine_missing() + sentence(),
      );
      action?.click();
      expect(open.mock.calls).toEqual([[page]]);
    },
  );
});
