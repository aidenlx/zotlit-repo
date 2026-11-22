import type { CliFlags, CliHandler } from "obsidian";

export function printableCliHandler(handler: CliHandler): CliHandler {
  return async (params) => {
    try {
      return await handler(params);
    } catch (error) {
      // oxlint-disable-next-line no-throw-literal, typescript/only-throw-error -- Obsidian prints only a string rejection.
      throw rejectionText(error);
    }
  };
}

export function handlerCheckedFlags(flags: CliFlags | null): CliFlags | null {
  if (flags === null) return null;
  return Object.fromEntries(
    Object.entries(flags).map(([name, { required, ...flag }]) => [
      name,
      required
        ? { ...flag, description: `${flag.description} (required)` }
        : flag,
    ]),
  );
}

function rejectionText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
