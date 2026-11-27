// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import type { RecordedNotice } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import type { NoticeAction } from "@zotlit/obsidian-kit/notice.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { FakeDevice } from "./__fixtures__.ts";
import { CHINESE_PACK, fakeDevice, startOn } from "./__fixtures__.ts";
import { layerLanguagePackNotices } from "./notices.ts";
import type { LanguagePackSituation } from "./service.ts";
import { LanguagePack } from "./service.ts";

const loadOn = Effect.fn("test.loadOn")(function* (
  device: FakeDevice,
  options: { language: string; pluginVersion?: string },
) {
  const pack = yield* startOn(device, options);
  return { pack, notices: yield* registerNotices(pack) };
});

const registerNotices = Effect.fn("test.registerNotices")(function* (
  pack: LanguagePack["Service"],
) {
  const notifier = testNotifier();
  yield* Layer.build(
    layerLanguagePackNotices.pipe(
      Layer.provide(Layer.succeed(LanguagePack, pack)),
      Layer.provide(notifier.layer),
    ),
  );
  return notifier.notices;
});

const leaving = (
  pack: LanguagePack["Service"],
  kind: LanguagePackSituation["kind"],
) =>
  pack.changes.pipe(
    Stream.filter((situation) => situation.kind !== kind),
    Stream.runHead,
  );

function textOf(message: RecordedNotice["messages"][number]): string {
  return noticeText(message);
}

function buttonsOf(
  notice: RecordedNotice | undefined,
): readonly NoticeAction[] {
  const message = notice?.messages[0];
  if (message === undefined || typeof message === "string") return [];
  return message.actions ?? [];
}

describe("Language Pack startup notices", () => {
  it.effect("offers the pack in the user's language, naming its Endonym", () =>
    Effect.gen(function* () {
      const { notices } = yield* loadOn(fakeDevice(), { language: "zh" });

      expect(notices).toHaveLength(1);
      expect(notices[0]?.duration).toBe(0);
      expect(textOf(notices[0]!.messages[0]!)).toContain(
        "ZotLit 简体中文 语言包可用。",
      );
      expect(buttonsOf(notices[0]).map((action) => action.label)).toEqual([
        m.notice_language_pack_decline_action(),
        m.notice_language_pack_install_action(),
      ]);
    }),
  );

  it.effect("shows nothing where no pack is offered", () =>
    Effect.gen(function* () {
      const { notices } = yield* loadOn(fakeDevice(), { language: "en" });

      expect(notices).toEqual([]);
    }),
  );

  it.effect("declining hides the offer and records the answer", () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const { pack, notices } = yield* loadOn(device, { language: "zh" });

      buttonsOf(notices[0])[0]!.run();
      yield* leaving(pack, "offered");

      expect(notices[0]?.hidden).toBe(true);
      expect(device.storage.get("zotlit:i18n:consent:zh-CN")).toBe("declined");
    }),
  );

  it.effect("interrupts a pending decline when the plugin unloads", () =>
    Effect.gen(function* () {
      const pack = yield* startOn(fakeDevice(), { language: "zh" });
      const started = yield* Deferred.make<void>();
      let interrupted = false;
      const notifier = testNotifier();
      const scope = yield* Scope.fork(yield* Scope.Scope);
      yield* Layer.buildWithScope(
        layerLanguagePackNotices.pipe(
          Layer.provide(
            Layer.succeed(
              LanguagePack,
              LanguagePack.of({
                ...pack,
                decline: Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interrupted = true;
                    }),
                  ),
                ),
              }),
            ),
          ),
          Layer.provide(notifier.layer),
        ),
        scope,
      );

      buttonsOf(notifier.notices[0])[0]!.run();
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);

      expect(interrupted).toBe(true);
    }),
  );

  it.effect(
    "installing from the offer hides it and reports the download until the restart notice",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        const { pack, notices } = yield* loadOn(device, { language: "zh" });

        buttonsOf(notices[0])[1]!.run();
        yield* leaving(pack, "offered");
        expect(notices[0]?.hidden).toBe(true);
        yield* leaving(pack, "downloading");
        yield* eventually(() => expect(notices).toHaveLength(2));

        expect(notices[1]?.messages.map(textOf)).toEqual([
          m.notice_language_pack_restart({ plugin: "ZotLit" }),
        ]);
        yield* TestClock.adjust("9 seconds");
        expect(notices[1]?.hidden).toBe(false);
        yield* TestClock.adjust("1 second");
        expect(notices[1]?.hidden).toBe(true);
      }),
  );

  it.effect(
    "an install from settings hides the offer, so the two entry points agree",
    () =>
      Effect.gen(function* () {
        const { pack, notices } = yield* loadOn(fakeDevice(), {
          language: "zh",
        });

        yield* pack.install;

        expect(notices[0]?.hidden).toBe(true);
      }),
  );

  it.effect(
    "a consented refresh shows its download, then the restart notice",
    () =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, {
          language: "zh",
          pluginVersion: "1.0.0",
        })).install;
        let answer!: () => void;
        device.held = new Promise<void>((resolve) => {
          answer = resolve;
        });

        const { pack, notices } = yield* loadOn(device, { language: "zh" });
        yield* TestClock.adjust("200 millis");
        expect(notices.map((notice) => notice.messages.map(textOf))).toEqual([
          [m.notice_language_pack_downloading({ plugin: "ZotLit" })],
        ]);

        answer();
        yield* leaving(pack, "downloading");
        yield* eventually(() => expect(notices[0]?.messages).toHaveLength(2));
        expect(notices[0]?.messages.map(textOf)).toEqual([
          m.notice_language_pack_downloading({ plugin: "ZotLit" }),
          m.notice_language_pack_restart({ plugin: "ZotLit" }),
        ]);
      }),
  );

  it.effect.each([
    [
      "the restart notice",
      CHINESE_PACK,
      () => m.notice_language_pack_restart({ plugin: "ZotLit" }),
    ],
    [
      "the failure",
      { status: 503, text: "unavailable" },
      () =>
        m.notice_language_pack_download_failed({
          plugin: "ZotLit",
          message:
            "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0/zh-CN.json responded 503",
        }),
    ],
  ] as const)(
    "a consented refresh that ends before the notices register still shows %s",
    ([, answer, expected]) =>
      Effect.gen(function* () {
        const device = fakeDevice();
        yield* (yield* startOn(device, {
          language: "zh",
          pluginVersion: "1.0.0",
        })).install;
        device.answer = answer;

        const pack = yield* startOn(device, { language: "zh" });
        yield* leaving(pack, "downloading");
        const notices = yield* registerNotices(pack);
        yield* eventually(() => expect(notices).toHaveLength(1));

        expect(notices[0]?.messages.map(textOf)).toEqual([expected()]);
      }),
  );

  it.effect.each([
    [
      "names the failure of a download",
      { status: 503, text: "unavailable" },
      () =>
        m.notice_language_pack_download_failed({
          plugin: "ZotLit",
          message:
            "https://github.com/aidenlx/zotlit/releases/download/res-2.0.0/zh-CN.json responded 503",
        }),
    ],
    [
      "asks for a plugin update for a pack from a newer lineage",
      JSON.stringify({ schemaVersion: 2, locale: "zh-CN", messages: {} }),
      () => m.notice_language_pack_update_needed({ plugin: "ZotLit" }),
    ],
  ] as const)("%s", ([, answer, expected]) =>
    Effect.gen(function* () {
      const device = fakeDevice(answer);
      const { pack, notices } = yield* loadOn(device, { language: "zh" });

      buttonsOf(notices[0])[1]!.run();
      yield* leaving(pack, "offered");
      yield* leaving(pack, "downloading");
      yield* eventually(() => expect(notices).toHaveLength(2));

      expect(notices[1]?.messages.map(textOf)).toEqual([expected()]);
    }),
  );
});
