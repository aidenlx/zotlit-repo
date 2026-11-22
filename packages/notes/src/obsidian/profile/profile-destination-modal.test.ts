import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import {
  ButtonComponent,
  controlsOf,
  TextComponent,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { ResolvedProfile } from "./bindings.ts";
import { ProfileDestinationModal } from "./profile-destination-modal.ts";
import type { PreparedProfileCreation } from "./service.ts";

import { defaults } from "#__fixtures__/settings.ts";

it("asks for a name, reports an edited invalid name, and accepts a name with an empty folder", async () => {
  using disabled = vi.spyOn(ButtonComponent.prototype, "setDisabled");
  const addDisabled = () =>
    disabled.mock.calls.findLast((_, index) => {
      const button = disabled.mock.instances[index];
      return (
        button instanceof ButtonComponent &&
        button.text === m.settings_profile_add()
      );
    })?.[0];
  const resolvedProfile = stubService<ResolvedProfile>("ResolvedProfile", {
    bindings: {
      ...defaults["note.default-profile"].bindings,
      "note.literature-folder": "Literature",
    },
  });
  const unconfirmedCreation: PreparedProfileCreation = {
    profile: resolvedProfile,
    source: "",
    inherited: [],
    create: async () => {
      throw new Error("creation is not confirmed");
    },
  };
  const invalidName = {
    ...unconfirmedCreation,
    constraint: {
      kind: "invalid-name" as const,
      message: "Enter a profile name",
    },
  };
  const prepareCreate = vi.fn<() => Promise<PreparedProfileCreation>>(
    async () => invalidName,
  );
  const modal = new ProfileDestinationModal({
    app: stubService<App>("App", {}),
    defaultFolder: "Literature",
    prepareCreate,
  });
  modal.onOpen();
  const status = () => modal.contentEl.querySelector('[role="status"]')!;
  const text = (name: string) =>
    [...modal.contentEl.querySelectorAll("label")]
      .filter((el) => el.firstChild?.textContent === name)
      .flatMap((el) => controlsOf(el.lastElementChild as HTMLElement))
      .find((control) => control instanceof TextComponent)!;
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Enter a profile name"),
  );
  expect(addDisabled()).toBe(true);
  expect(text(m.settings_profile_folder_name()).inputEl.placeholder).toBe(
    m.settings_profile_same_as_default({ value: "Literature" }),
  );
  prepareCreate.mockResolvedValueOnce({
    ...unconfirmedCreation,
    constraint: { kind: "invalid-name", message: "Name already used" },
  });
  text(m.settings_profile_name_name()).type("Books");
  await vi.waitFor(() =>
    expect(status().textContent).toBe("Name already used"),
  );
  expect(addDisabled()).toBe(true);
  prepareCreate.mockResolvedValueOnce(unconfirmedCreation);
  text(m.settings_profile_name_name()).type("Reading");
  await vi.waitFor(() => expect(addDisabled()).toBe(false));
  expect(status().textContent).toBe("");
  expect(prepareCreate).toHaveBeenLastCalledWith({
    label: "Reading",
    look: "default",
    bindings: { folder: undefined },
  });
  modal.onClose();
});
