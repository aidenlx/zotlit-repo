import "core-js/proposals/explicit-resource-management";
import { BOOTSTRAP_BUNDLE_NAME, MAIN_BUNDLE_NAME } from "./constant.ts";
import type { BootstrapReason } from "./lib/bootstrap-reasons.ts";
import { logToBrowserConsole } from "./lib/zotero-log.js";
import type { ZotLitZotero as ZotLitZoteroCtor } from "./main.ts";

interface BootstrapData {
  id: string;
  version: string;
  rootURI: string;
}

interface WindowBootstrapData extends BootstrapData {
  window: Window;
}

interface MainScope {
  ZotLitZotero?: typeof ZotLitZoteroCtor;
}

let plugin: InstanceType<typeof ZotLitZoteroCtor> | undefined;

function logBootstrapError(message: string, error: unknown): void {
  const detail =
    error instanceof Error
      ? `[${error.name}] ${error.message}\n${error.stack ?? ""}`
      : String(error);
  const printMessage = `${message}: ${detail}`;
  logToBrowserConsole(printMessage, "error", BOOTSTRAP_BUNDLE_NAME);
  Zotero.debug(printMessage, 1);
}

function loadMain(rootURI: string): typeof ZotLitZoteroCtor {
  const scope: MainScope = Object.create(null) as MainScope;
  Services.scriptloader.loadSubScript(`${rootURI}${MAIN_BUNDLE_NAME}`, scope);
  const ctor = scope.ZotLitZotero;
  if (!ctor) {
    throw new Error(
      `${MAIN_BUNDLE_NAME} did not expose ZotLitZotero on the load scope — check vite output.footer`,
    );
  }
  return ctor;
}

export function install(_data: BootstrapData, _reason: BootstrapReason): void {}

export function uninstall(
  _data: BootstrapData,
  _reason: BootstrapReason,
): void {}

export function startup(
  { id, version, rootURI }: BootstrapData,
  reason: BootstrapReason,
): void {
  try {
    const ZotLitZotero = loadMain(rootURI);
    plugin = new ZotLitZotero({ id, version, rootURI });
    plugin.startup(reason).catch((error: unknown) => {
      logBootstrapError("ZotLit startup error", error);
    });
  } catch (error: unknown) {
    logBootstrapError("ZotLit startup error", error);
  }
}

export function shutdown(_data: BootstrapData, reason: BootstrapReason): void {
  const current = plugin;
  plugin = undefined;
  current?.shutdown(reason).catch((error: unknown) => {
    logBootstrapError("ZotLit shutdown error", error);
  });
}

export function onMainWindowLoad({ window }: WindowBootstrapData): void {
  plugin?.onMainWindowLoad(window);
}

export function onMainWindowUnload({ window }: WindowBootstrapData): void {
  plugin?.onMainWindowUnload(window);
}
