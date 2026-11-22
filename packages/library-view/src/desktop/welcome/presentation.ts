import type { ReaderStatus } from "@zotlit/annotations/obsidian/reader-connection/status.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import type { ConnectionReadout } from "./connection.ts";

export interface WelcomeState {
  migrationPending: boolean;
  dismissed: boolean;
  requested: boolean;
  stepsShown: boolean;
  requests: number;
  converted: boolean;
  connection: ConnectionReadout;
  companionInstalled: boolean;
  readerStatus: ReaderStatus;
  literatureFolder: string;
  literatureFolderExists: boolean;
  templateConversionPending: boolean;
  templateFolder: string;
  templateConversionResult: Settings["note.template-conversion-result"];
  v1TemplatesPresent: boolean;
  notFound: boolean;
  version: string;
  updatePending: boolean;
  noticesEnabled: boolean;
}

export interface BannerSections {
  readonly steps: "open" | "folded" | false;
  readonly connect: boolean;
  readonly conversion: "offer" | "result" | null;
  readonly migration: boolean;
  readonly companion: boolean;
  readonly update: boolean;
}

export function bannerSections(state: WelcomeState): BannerSections | null {
  const update = state.updatePending && state.noticesEnabled;
  if (state.dismissed && !state.migrationPending) {
    return update
      ? {
          steps: false,
          connect: false,
          conversion: null,
          migration: false,
          companion: false,
          update,
        }
      : null;
  }
  const known = state.connection.status !== "checking";
  const done =
    state.connection.status === "connected" && state.literatureFolderExists;
  const open = state.requested || (known && !done);
  const underway = open || state.migrationPending;
  const result = state.templateConversionResult;
  const conversion = state.templateConversionPending
    ? "offer"
    : result &&
        (underway || state.converted || result.pendingCleanup.length > 0)
      ? "result"
      : null;
  const migration = underway && conversion === null && state.v1TemplatesPresent;
  const companion = state.migrationPending;
  const notice = conversion !== null || migration || companion;
  const steps = open ? "open" : notice && done ? "folded" : false;
  const sections: BannerSections = {
    steps,
    connect: steps !== false && !state.notFound,
    conversion,
    migration,
    companion,
    update,
  };
  return steps !== false || notice || update ? sections : null;
}

export function bannerBadge(
  state: WelcomeState,
): "upgraded" | "updated" | "get-started" {
  if (state.migrationPending) return "upgraded";
  if (bannerSections(state)?.update) return "updated";
  return "get-started";
}
