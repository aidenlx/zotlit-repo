// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type {
  ProfileId,
  ProfileSelector,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Customize } from "@/services/local-bridge/customize.ts";
import type { CustomizeRequest } from "@/services/local-bridge/customize.ts";
import { profileReader } from "@/services/profile/__fixtures__/reader.ts";
import { Profile } from "@/services/profile/service.ts";
import type { LiteratureNoteProfile } from "@/services/profile/service.ts";

import { duplicateProfileToWorkbench } from "./duplicate-profile.ts";

const COPY: LiteratureNoteProfile = {
  id: "Jk6Lm8Np2Qr4" as ProfileId,
  label: "Reading copy",
  document: "zotlit-profile.reading-copy.md",
  path: "templates/zotlit-profile.reading-copy.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

describe("Duplicate Profile workbench handoff", () => {
  it.effect.each(["default", "Bk3Qn7XvT2Lp"])(
    "opens the new copy from %s through the shared workbench flow",
    (id) =>
      Effect.gen(function* () {
        const close = vi.fn<() => void>();
        const customize = vi.fn((_request: CustomizeRequest) => {
          expect(close).toHaveBeenCalledOnce();
        });
        const duplicate = vi.fn(() => Effect.succeed(COPY));

        yield* duplicateProfileToWorkbench(id as ProfileSelector).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.mock(Customize, {
                open: (request) => Effect.sync(() => customize(request)),
              }),
              Layer.mock(Profile, {
                resolveProfile: () =>
                  Effect.succeed(profileReader().resolveProfile("default")!),
                duplicate,
              }),
              Layer.succeed(
                PluginHost,
                stubService<PluginHost["Service"]>("PluginHost", {
                  closeSettings: Effect.sync(close),
                }),
              ),
              testNotifier().layer,
            ),
          ),
        );

        expect(duplicate).toHaveBeenCalledWith(id, {});
        expect(customize).toHaveBeenCalledExactlyOnceWith({
          profileId: COPY.id,
        });
      }),
  );
});
