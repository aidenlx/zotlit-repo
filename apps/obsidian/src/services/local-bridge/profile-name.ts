// The name the Workbench and the launch sheet show for a Profile.

import { Effect } from "effect";

import {
  DEFAULT_PROFILE,
  isProfileId,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Profile } from "@/services/profile/service.ts";

/**
 * The Profile's own label, the built-in name for Default, and the id itself
 * when the vault no longer carries that Profile.
 */
export const profileDisplayName = Effect.fnUntraced(function* (
  profileId: string,
) {
  if (profileId === DEFAULT_PROFILE) return m.settings_profile_default_name();
  const profiles = yield* Profile;
  if (!(yield* profiles.loaded) || !isProfileId(profileId)) return profileId;
  const resolved = yield* Effect.orDie(profiles.resolveProfile(profileId));
  return resolved?.label ?? profileId;
});
