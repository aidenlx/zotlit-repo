export async function withExcerptCleanup(
  verify: (cleanup: AsyncDisposableStack) => Promise<void>,
): Promise<void> {
  try {
    await using cleanup = new AsyncDisposableStack();
    await verify(cleanup);
  } catch (error) {
    if (!(error instanceof SuppressedError)) throw error;
    throw new AggregateError(
      excerptFailures(error),
      "Excerpt acceptance failed",
    );
  }
}

function excerptFailures(error: unknown): unknown[] {
  return error instanceof SuppressedError
    ? [...excerptFailures(error.suppressed), ...excerptFailures(error.error)]
    : [error];
}

async function cleanupStep(
  what: string,
  restore: () => Promise<void>,
): Promise<void> {
  try {
    await restore();
  } catch {
    try {
      await restore();
    } catch (error) {
      throw new Error(`Excerpt acceptance could not ${what}`, { cause: error });
    }
  }
}

export function deferExcerptCleanup(
  cleanup: AsyncDisposableStack,
  what: string,
  restore: () => Promise<void>,
): void {
  cleanup.defer(() => cleanupStep(what, restore));
}

export function deferExcerptImportCleanup(
  cleanup: AsyncDisposableStack,
  settleImport: () => Promise<void>,
): AsyncDisposableStack {
  const importCleanup = new AsyncDisposableStack();
  cleanup.defer(async () => {
    await cleanupStep("wait for the note import to settle", settleImport);
    await importCleanup.disposeAsync();
  });
  return importCleanup;
}
