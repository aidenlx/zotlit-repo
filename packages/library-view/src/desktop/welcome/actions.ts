import { createContext, useContext } from "react";

import type { SetupActions } from "./setup-actions.ts";

export interface WelcomeBannerHost {
  searchLibrary: () => void;
}

export interface WelcomeActions extends SetupActions, WelcomeBannerHost {
  openExternal: (url: string) => void;
  dismiss: () => void;
  showSteps: (shown: boolean) => void;
  openReleaseNote: () => void;
  retryTemplateCleanup: () => void;
  convertLiteratureNoteTemplates: () => void;
}

export const WelcomeActionsContext = createContext<WelcomeActions | null>(null);

export function useWelcomeActions(): WelcomeActions {
  const actions = useContext(WelcomeActionsContext);
  if (!actions) {
    throw new Error(
      "useWelcomeActions must be used within WelcomeActionsContext",
    );
  }
  return actions;
}
