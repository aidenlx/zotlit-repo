import { getLogger } from "@logtape/logtape";

const logger = getLogger(["zotlit", "zotero", "launch-url"]);

function isMissingPrincipalFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { result?: unknown }).result ===
      Components.results.NS_ERROR_ILLEGAL_VALUE
  );
}

interface LaunchServices {
  io: nsIIOService;
  scriptSecurityManager: nsIScriptSecurityManager;
}

export function launchExternalUrl(url: string): void {
  try {
    Zotero.launchURL(url);
    return;
  } catch (error) {
    if (!isMissingPrincipalFailure(error)) throw error;
    logger.warn("retrying external launch with a system principal", { url });
  }

  const { io, scriptSecurityManager } = Services as unknown as LaunchServices;
  Cc["@mozilla.org/uriloader/external-protocol-service;1"]!.getService(
    Ci.nsIExternalProtocolService,
  ).loadURI(io.newURI(url), scriptSecurityManager.getSystemPrincipal());
}
