import { obRun } from "./obsidian-cli.ts";

export async function withWorkbenchSurfaces<T>(
  vaultId: string,
  wait: Promise<T>,
): Promise<T> {
  try {
    return await wait;
  } catch (error) {
    const surfaces = await obRun(
      vaultId,
      ({ page }) => JSON.stringify(page.workbenchSurfaces()),
      undefined,
    ).catch((reason: unknown) => `unreadable: ${String(reason)}`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nTemplate Workbench surfaces: ${surfaces}`,
      { cause: error },
    );
  }
}
