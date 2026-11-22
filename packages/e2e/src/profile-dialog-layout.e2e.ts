import { describe, expect, it } from "vitest";

import { reachable } from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";

describe.skipIf(!reachable)("Profile dialog layout", () => {
  registerEndToEndRunHooks();

  it("draws the Create profile hint neutrally, then marks an edited invalid name as an error", async () => {
    const drawing = await obRun(
      run.vaultId,
      async (
        { app, page },
        {
          newProfile,
          addProfile,
          nameLabel,
          cancelLabel,
          previewPath,
          invalidName,
        },
      ) => {
        await using cleanup = new AsyncDisposableStack();
        const file = cleanup.adopt(
          await app.vault.create(
            "Profile dialog layout.md",
            "---\nzotero-key: RUGIER24\n---\nReading notes.",
          ),
          (file) => app.vault.delete(file),
        );
        const leaf = cleanup.adopt(app.workspace.getLeaf("tab"), (leaf) =>
          leaf.detach(),
        );
        await leaf.openFile(file);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await page.until(
          "the literature note metadata",
          () =>
            app.metadataCache.getFileCache(file)?.frontmatter?.[
              "zotero-key"
            ] === "RUGIER24",
        );
        app.commands.executeCommandById(
          "zotlit:switch-literature-note-profile",
        );
        const choice = await page.until("the New profile choice", () =>
          [
            ...activeDocument.querySelectorAll<HTMLElement>(".suggestion-item"),
          ].find((el) => el.textContent.includes(newProfile)),
        );
        page.press(choice, "New profile");
        const modal = await page.until("the Create profile modal", () =>
          [...activeDocument.querySelectorAll<HTMLElement>(".modal")].find(
            (el) =>
              el.querySelector(".modal-title")?.textContent === addProfile,
          ),
        );
        cleanup.defer(() =>
          [...modal.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent === cancelLabel)
            ?.click(),
        );
        const status = modal.querySelector<HTMLElement>('[role="status"]')!;
        await page.until(
          "the initial profile name hint",
          () => status.textContent === invalidName,
        );
        const sample = modal.ownerDocument.createElement("span");
        modal.append(sample);
        cleanup.defer(() => sample.remove());
        sample.style.color = "var(--text-muted)";
        const neutral =
          getComputedStyle(status).color === getComputedStyle(sample).color;
        const preview = [
          ...modal.querySelectorAll<HTMLElement>('[role="heading"]'),
        ].find((el) => el.textContent === previewPath);
        const input = [...modal.querySelectorAll("label")]
          .find((el) => el.firstChild?.textContent === nameLabel)!
          .querySelector("input")!;
        input.value = "Default";
        input.dispatchEvent(
          new input.ownerDocument.defaultView!.Event("input", {
            bubbles: true,
          }),
        );
        sample.style.color = "var(--text-error)";
        await page.until(
          "the edited name error color",
          () =>
            getComputedStyle(status).color === getComputedStyle(sample).color,
        );
        return {
          neutral,
          error:
            getComputedStyle(status).color === getComputedStyle(sample).color,
          preview: !!preview && preview.getBoundingClientRect().width > 0,
        };
      },
      {
        newProfile: run.m.modal_profile_new(),
        addProfile: run.m.settings_profile_add(),
        nameLabel: run.m.settings_profile_name_name(),
        cancelLabel: run.m.modal_cancel(),
        previewPath: run.m.settings_profile_preview_path(),
        invalidName: run.m.settings_profile_name_invalid(),
      },
      { timeoutMs: 30_000 },
    );
    expect(drawing).toEqual({ neutral: true, error: true, preview: true });
  });
});
