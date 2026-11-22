export const BOOTSTRAP_REASONS = {
  1: "APP_STARTUP",
  2: "APP_SHUTDOWN",
  3: "ADDON_ENABLE",
  4: "ADDON_DISABLE",
  5: "ADDON_INSTALL",
  6: "ADDON_UNINSTALL",
  7: "ADDON_UPGRADE",
  8: "ADDON_DOWNGRADE",
  9: "MAIN_WINDOW_LOAD",
  10: "MAIN_WINDOW_UNLOAD",
} as const;

export type BootstrapReason = keyof typeof BOOTSTRAP_REASONS;

export type BootstrapReasonName = (typeof BOOTSTRAP_REASONS)[BootstrapReason];
