import { Effect } from "effect";

import {
  Profile,
  ProfileOperationError,
} from "@zotlit/notes/obsidian/profile/service.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Customize } from "#desktop/view/customize.ts";

export const duplicateProfileToWorkbench = Effect.fn(
  "duplicateProfileToWorkbench",
)(function* (selector: ProfileSelector, options: { label?: string } = {}) {
  const profile = yield* Profile;
  const source = yield* profile.resolveProfile(selector);
  if (!source)
    return yield* new ProfileOperationError({
      message: `Unknown Profile: ${selector}`,
      cause: undefined,
    });
  const copy = yield* profile.duplicate(selector, options);
  yield* (yield* PluginHost).closeSettings;
  yield* (yield* Customize).open({ profileId: copy.id });
  yield* (yield* Notifier).show(
    m.notice_profile_duplicated({
      label: source.label ?? m.settings_profile_default_name(),
    }),
  );
});
