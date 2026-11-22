import { DateTime, Effect, FiberHandle, Queue, Stream } from "effect";
import type { ButtonComponent, Setting, SettingGroupItem } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { editingCapabilityCopy } from "./capability-copy.ts";
import { applyAction, editingRowModel } from "./editing-settings-model.ts";
import { CapabilityNotices } from "./notices.ts";
import { AnnotationRepository } from "./service.ts";

export function zoteroEditingRow(
  ctx: SettingTabContext,
): SettingGroupItem<SettingsKey> {
  return {
    id: "settings_zotero_editing",
    name: m.settings_zotero_editing_name(),
    desc: m.settings_zotero_editing_desc(),
    render: (setting) => renderEditingRow(setting, ctx),
  };
}

function renderEditingRow(
  setting: Setting,
  ctx: SettingTabContext,
): () => void {
  const desc = createFragment();
  const statusEl = createDiv({
    cls: "zt:font-medium zt:text-foreground",
    attr: { role: "status" },
  });
  desc.append(statusEl);
  const detailEl = createSpan({ cls: "zt:block zt:text-(--text-muted)" });
  desc.append(detailEl);
  const rememberedEl = createDiv({
    cls: "zt:mt-1 zt:text-muted-foreground",
    text: m.settings_zotero_editing_saved(),
  });
  desc.append(rememberedEl);
  setting.setDesc(desc);

  let enableButton: ButtonComponent | undefined;
  let checkButton: ButtonComponent | undefined;
  let forgetButton: ButtonComponent | undefined;
  setting
    .addButton((button) => {
      enableButton = button.setButtonText(m.settings_zotero_editing_enable());
      button.setCta();
    })
    .addButton((button) => {
      checkButton = button.setButtonText(m.settings_zotero_editing_check());
    })
    .addButton((button) => {
      forgetButton = button.setButtonText(m.settings_zotero_editing_forget());
    });

  return ctx.tab.mount(
    Effect.gen(function* () {
      const repository = yield* AnnotationRepository;
      const localApi = yield* ZoteroLocalApi;
      const notices = yield* CapabilityNotices;
      const rereads = yield* Queue.unbounded<void>();
      let remembered = false;
      let checking = false;
      const countdown = yield* FiberHandle.make();
      const tick: Effect.Effect<boolean> = Effect.suspend(() => apply).pipe(
        Effect.delay("1 second"),
        Effect.repeat({ while: (countsDown) => countsDown }),
      );

      const apply = Effect.gen(function* () {
        const capability = yield* repository.capability;
        const model = editingRowModel({
          capability,
          checking,
          remembered,
          now: yield* DateTime.now,
        });
        statusEl.textContent = model.status.label;
        statusEl.classList.toggle(
          "mod-warning",
          model.status.tone === "warning",
        );
        detailEl.textContent = model.status.detail ?? "";
        detailEl.toggle(model.status.detail !== null);
        rememberedEl.toggle(remembered && capability.kind === "read-only");
        applyAction(checkButton, model.check);
        applyAction(enableButton, model.enable);
        applyAction(forgetButton, model.forget);
        if (model.countsDown) {
          yield* FiberHandle.run(countdown, tick, { onlyIfMissing: true });
        }
        return model.countsDown;
      });

      const runCheck = Effect.gen(function* () {
        checking = true;
        yield* apply;
        yield* repository.probe;
        const result = editingCapabilityCopy(
          yield* repository.capability,
          yield* DateTime.now,
        );
        new BaseNotice(
          BaseNotice.render((notice) => {
            notice.setTitle(result.label);
            if (result.detail) notice.addText(result.detail);
          }),
        );
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            checking = false;
            return apply.pipe(Effect.andThen(Queue.offer(rereads, undefined)));
          }),
        ),
      );
      const check = Effect.suspend(() => (checking ? Effect.void : runCheck));

      checkButton?.onClick(
        () => void ctx.tab.run(check, m.settings_failed_zotero_editing_check()),
      );
      forgetButton?.onClick(
        () =>
          void ctx.tab.run(
            localApi.forgetAuthorization.pipe(
              Effect.andThen(Queue.offer(rereads, undefined)),
            ),
            m.settings_failed_zotero_editing_forget(),
          ),
      );
      enableButton?.onClick(
        () =>
          void ctx.tab.run(
            notices.allowEditing,
            m.settings_failed_zotero_editing_enable(),
          ),
      );

      yield* apply;
      yield* Effect.forkScoped(repository.probe);
      yield* Stream.merge(
        Stream.make(undefined),
        Stream.merge(
          repository.capabilityChanges.pipe(Stream.tap(() => apply)),
          Stream.fromQueue(rereads),
        ),
      ).pipe(
        Stream.switchMap(() =>
          Stream.fromEffect(
            localApi.remembered.pipe(
              recover(
                (cause) =>
                  Effect.logWarning(
                    "Cannot read the Remembered Write Authorization",
                    cause,
                  ),
                Effect.sync(() => remembered),
              ),
            ),
          ),
        ),
        Stream.runForEach((value) => {
          remembered = value;
          return apply;
        }),
      );
    }),
  );
}

declare module "@zotlit/plugin-services/obsidian/setting-tab/effect-tab.ts" {
  interface SettingTabServiceRegistry {
    AnnotationRepository: AnnotationRepository;
    CapabilityNotices: CapabilityNotices;
    ZoteroLocalApi: ZoteroLocalApi;
  }
}
