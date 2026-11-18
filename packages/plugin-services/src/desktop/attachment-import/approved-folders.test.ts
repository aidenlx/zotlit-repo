import type {
  SettingsKey,
  SettingTabContext,
} from "#obsidian/setting-tab/context.ts";
// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Ref } from "effect";
import type { SettingDefinitionList } from "obsidian";

import { DeviceStorageError } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { approvedFoldersPage } from "./approved-folders.ts";
import { AttachmentImport } from "./service.ts";

import { failureOf, recordingRuns } from "#__fixtures__/setting-tab-harness.ts";
import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";

/** The approved-folder list of the page over `service`, with the runs it started. */
const folderList = Effect.fnUntraced(function* (
  service: AttachmentImport["Service"],
) {
  const { tab, runs } = recordingRuns(
    (yield* scopedSettingTab(Context.make(AttachmentImport, service))).tab,
  );
  const page = approvedFoldersPage(
    stubService<SettingTabContext>("SettingTabContext", { tab }),
  );
  const list = page.items?.find(
    (item): item is SettingDefinitionList<SettingsKey> =>
      "type" in item && item.type === "list",
  );
  if (!list) throw new Error("Approved folder list missing");
  return { list, runs };
});

it.effect("lists the approved folders and revokes the one deleted", () =>
  Effect.gen(function* () {
    const folders = yield* Ref.make<readonly string[]>(["/a", "/b"]);
    const revoked = yield* Deferred.make<void>();
    const { list } = yield* folderList(
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFolders: Ref.get(folders),
        revokeFolder: (folder) =>
          Ref.update(folders, (all) =>
            all.filter((path) => path !== folder),
          ).pipe(Effect.andThen(Deferred.succeed(revoked, undefined))),
      }),
    );

    expect(list.items?.map((item) => item.name)).toEqual(["/a", "/b"]);
    list.onDelete?.(0);
    yield* Deferred.await(revoked);
    expect(yield* Ref.get(folders)).toEqual(["/b"]);
  }),
);

it.effect("fails the revoke under its label when storage refuses it", () =>
  Effect.gen(function* () {
    const failure = new DeviceStorageError({
      operation: "saveLocalStorage",
      key: "zotlit-approved-folders",
      message: "Storage is full",
      cause: null,
    });
    const asked: string[] = [];
    const { list, runs } = yield* folderList(
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFolders: Effect.succeed(["/a"]),
        revokeFolder: (folder) =>
          Effect.sync(() => asked.push(folder)).pipe(
            Effect.andThen(Effect.fail(failure)),
          ),
      }),
    );

    list.onDelete?.(0);
    yield* eventually(() => expect(runs).toHaveLength(1));
    expect(asked).toEqual(["/a"]);
    expect(failureOf(runs[0]!)).toBe(failure);
    expect(runs[0]!.label).toBe(m.settings_failed_revoke_folder());
  }),
);
