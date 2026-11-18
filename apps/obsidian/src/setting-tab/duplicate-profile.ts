// Duplicate a Profile and open the copy through the shared workbench flow.
import { Effect } from "effect";

import * as m from "@/lib/i18n/generated/messages.ts";
import { Notifier } from "@/lib/notifier.ts";
import { PluginHost } from "@/lib/plugin-host.ts";
import type { ProfileSelector } from "@/lib/profile-stamp.ts";
import { Customize } from "@/services/local-bridge/customize.ts";
import { Profile, ProfileOperationError } from "@/services/profile/service.ts";

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
