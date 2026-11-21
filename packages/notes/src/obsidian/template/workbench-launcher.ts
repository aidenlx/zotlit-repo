import type { ProfileOperationError } from "#obsidian/profile/service.ts";
// Opening a Template Document in the Template Workbench View, which the
// Template Workbench owns. The Citation Template's actions and the Profile
// dialogs open a document through this port; the Template Workbench fills it,
// and the host composes its layer.
import { Context } from "effect";
import type { Cause, Effect } from "effect";
import type { TFile, WorkspaceLeaf } from "obsidian";

import type { TemplateFailure } from "./service.ts";

/** How a Template Document opens in the Template Workbench View. */
export interface TemplateWorkbenchLaunch {
  /** The tab the view shows first. */
  readonly tab?: "name";
  /** The leaf the open starts from; the document opens in a new tab beside it. */
  readonly from?: { readonly leaf: WorkspaceLeaf; readonly place: "tab" };
}

/** What an open of a Template Document fails with. */
export type TemplateWorkbenchLaunchError =
  | ProfileOperationError
  | TemplateFailure
  | Cause.UnknownError;

export class TemplateWorkbenchLauncher extends Context.Service<
  TemplateWorkbenchLauncher,
  {
    /**
     * Open `file` in the Template Workbench View, and show a notice for each
     * thing the open asks the reader to know.
     */
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
