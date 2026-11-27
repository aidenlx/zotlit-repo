import { obRun, readUntil } from "./obsidian-cli.ts";
import type { JsonCompatible, ObsidianContext } from "./page-context.ts";
import type { NoteQueryView } from "./page-helpers.ts";

const FIRST_DRAW_ATTEMPTS = 6;

const CANNOT_REVEAL = "Cannot reveal";
const NOT_DRAWN = "Not drawn";

export type { NoteQueryView } from "./page-helpers.ts";

export type QueryViewTarget =
  | { embed: string; occurrence?: number }
  | { block: number };

interface Kind {
  name: string;
  opens: string;
  closes: string | null;
  index: number;
  selector: string;
  src: string | null;
}

const FENCE = "(```|~~~)";

function kindOf(target: QueryViewTarget): Kind {
  if ("block" in target)
    return {
      name: `Query Block #${target.block}`,
      opens: `^${FENCE}zotquery\\b`,
      closes: `^${FENCE}\\s*$`,
      index: target.block,
      selector: ".block-language-zotquery",
      src: null,
    };
  const occurrence = target.occurrence ?? 0;
  const link = RegExp.escape(`![[${target.embed}`);
  return {
    name: `embed of ${target.embed} #${occurrence}`,
    opens: `${link}(\\]\\]|\\|)`,
    closes: null,
    index: occurrence,
    selector: ".internal-embed",
    src: target.embed,
  };
}

function isRevealFailure(error: unknown): boolean {
  const message = String(error);
  return message.includes(CANNOT_REVEAL) || message.includes(NOT_DRAWN);
}

export async function revealQueryView(
  vaultId: string,
  notePath: string,
  target: QueryViewTarget,
): Promise<NoteQueryView> {
  const handle: NoteQueryView = { path: notePath, kind: kindOf(target) };
  let failure: unknown;
  for (let attempt = 0; attempt < FIRST_DRAW_ATTEMPTS; attempt++) {
    try {
      await obRun(
        vaultId,
        async ({ page }, handle) => {
          await page.revealQueryView(handle);
        },
        handle,
      );
      return handle;
    } catch (error) {
      if (String(error).includes(CANNOT_REVEAL)) throw error;
      failure = error;
    }
  }
  throw failure;
}

type QueryViewReadOptions<T> = {
  ready: (value: T) => boolean;
  what: string;
  tries?: number;
};
type QueryViewReader<A, T> = (
  context: ObsidianContext,
  args: A,
) => (T & JsonCompatible<T>) | Promise<T & JsonCompatible<T>>;

// oxlint-disable-next-line max-params -- Keep the typed callback API aligned with obRun.
export async function readQueryViewUntil<A, T>(
  vaultId: string,
  callback: QueryViewReader<A, T>,
  args: A & JsonCompatible<A>,
  { ready, ...options }: QueryViewReadOptions<T>,
): Promise<T> {
  let lastError = null as string | null;
  try {
    return await readUntil(
      async () => {
        try {
          // oxlint-disable-next-line zotlit-tests/no-eval-capture -- Forward the caller-checked callback through the transport.
          return await obRun<A, T>(vaultId, callback, args);
        } catch (error) {
          if (isRevealFailure(error)) throw error;
          lastError = String(error);
          return null;
        }
      },
      ready,
      options,
    );
  } catch (error) {
    if (lastError === null || isRevealFailure(error)) throw error;
    throw new Error(`${String(error)}; last failed call: ${lastError}`, {
      cause: error,
    });
  }
}
