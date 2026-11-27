import type { ProfileOperationError } from "#obsidian/profile/service.ts";
import type { Cause, Effect } from "effect";
import { Context } from "effect";
import type { TFile, WorkspaceLeaf } from "obsidian";

import type { TemplateFailure } from "./service.ts";

export interface TemplateWorkbenchLaunch {
  readonly tab?: "name";
  readonly from?: { readonly leaf: WorkspaceLeaf; readonly place: "tab" };
}

export type TemplateWorkbenchLaunchError =
  | ProfileOperationError
  | TemplateFailure
  | Cause.UnknownError;

export class TemplateWorkbenchLauncher extends Context.Service<
  TemplateWorkbenchLauncher,
  {
    open(
      file: TFile,
      options?: TemplateWorkbenchLaunch,
    ): Effect.Effect<void, TemplateWorkbenchLaunchError>;
  }
>()("zotlit/template/TemplateWorkbenchLauncher") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    TemplateWorkbenchLauncher: TemplateWorkbenchLauncher;
  }
}
