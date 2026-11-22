import type { PairedZotero } from "./paired-zotero.ts";

export type PairedRunMode = "open" | "dev";

export interface PairedRunOptions {
  mode: PairedRunMode;
  scopeCase: string;
  vaultCase?: string;
  purge: boolean;
  localApi?: boolean;
  grantLocalApiWrites?: boolean;
}

export interface DevelopmentVault {
  id: string;
  path: string;
}

export interface DevelopmentSession {
  ready: Promise<PairedZotero>;
  closed: Promise<void>;
}

export interface PairedRunReady {
  mode: PairedRunMode;
  vault: DevelopmentVault;
  zotero: PairedZotero;
  liveUpdatePort: number;
  zoteroHttpPort: number;
  localApi: boolean;
}

export interface LivePairedZotero {
  command: string;
  pid: number;
}

export interface PairedRunPorts {
  assertObsidianHost(): Promise<void>;
  stopLivePairedZotero(): Promise<readonly LivePairedZotero[]>;
  allocateLiveUpdatePort(): Promise<number>;
  allocateZoteroHttpPort(): Promise<number>;
  prepareDevelopmentVault(options: {
    scopeCase: string;
    vaultCase?: string;
    purge: boolean;
    liveUpdatePort: number;
    zoteroHttpPort: number;
    localApi: boolean;
    grantLocalApiWrites: boolean;
  }): Promise<DevelopmentVault>;
  openPairedZotero(): Promise<PairedZotero>;
  startDevelopmentSession(options: {
    vaultCase?: string;
  }): Promise<DevelopmentSession>;
  reportReady(result: PairedRunReady): void;
}

export async function runPairedRun(
  options: PairedRunOptions,
  ports: PairedRunPorts,
): Promise<void> {
  const localApi = options.localApi ?? false;
  const grantLocalApiWrites = options.grantLocalApiWrites ?? true;
  if (options.mode === "open") {
    await ports.stopLivePairedZotero();
    const liveUpdatePort = await ports.allocateLiveUpdatePort();
    const zoteroHttpPort = await ports.allocateZoteroHttpPort();
    await ports.assertObsidianHost();
    const vault = await ports.prepareDevelopmentVault({
      scopeCase: options.scopeCase,
      vaultCase: options.vaultCase,
      purge: options.purge,
      liveUpdatePort,
      zoteroHttpPort,
      localApi,
      grantLocalApiWrites,
    });
    const zotero = await ports.openPairedZotero();
    ports.reportReady({
      mode: options.mode,
      vault,
      zotero,
      liveUpdatePort,
      zoteroHttpPort,
      localApi,
    });
    return;
  }

  await ports.assertObsidianHost();
  await ports.stopLivePairedZotero();
  const liveUpdatePort = await ports.allocateLiveUpdatePort();
  const zoteroHttpPort = await ports.allocateZoteroHttpPort();
  const vault = await ports.prepareDevelopmentVault({
    scopeCase: options.scopeCase,
    vaultCase: options.vaultCase,
    purge: options.purge,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
    grantLocalApiWrites,
  });

  const session = await ports.startDevelopmentSession({
    vaultCase: options.vaultCase,
  });
  const zotero = await session.ready;
  ports.reportReady({
    mode: options.mode,
    vault,
    zotero,
    liveUpdatePort,
    zoteroHttpPort,
    localApi,
  });
  await session.closed;
}
