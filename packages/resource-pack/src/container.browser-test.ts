// The Pack container cases. Each case builds a pack from small fixture entries
// with the writer, reads it back with the reader, and returns a plain outcome
// beside the outcome it must give. The Node suite (`container.test.ts`) and the
// Electron renderer suite (`apps/resources`) run the same cases, so the reader
// is proven on Node's web APIs and on a browser's real `fetch`, `crypto.subtle`
// and `DecompressionStream`.
import type { RangeFetch } from "#fetch-range.ts";
import type { ReadRange } from "#reader.ts";

import { fetchRange } from "#fetch-range.ts";
import { PACK_INDEX_BYTES, parseIndex } from "#format.ts";
import { applyObsidianInstall } from "#obsidian-install.ts";
import { bytesRange, readPackEntry } from "#reader.ts";
import { writePack } from "#writer.ts";

/** Deterministic bytes that gzip poorly, so an entry spans several stream chunks. */
function noise(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = state >>> 24;
  }
  return bytes;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

const ALPHA = new TextEncoder().encode("\0asm alpha ".repeat(40));
const BETA = noise(300_000, 42);

async function fixturePack(compat?: number): Promise<Uint8Array<ArrayBuffer>> {
  return writePack({
    compat,
    notice: "alpha: MIT, https://example.invalid/alpha",
    entries: [
      { name: "alpha", bytes: ALPHA, sha256: await sha256(ALPHA) },
      { name: "beta", bytes: BETA, sha256: await sha256(BETA) },
    ],
  });
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const bytesOf = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value);

function same(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

/** What a read gave: `same` for the source bytes, else the failure kind. */
async function outcome(
  read: ReadRange,
  name: string,
  source: Uint8Array,
): Promise<string> {
  const result = await readPackEntry(read, name);
  if (!result.ok) return result.failure.kind;
  return same(result.bytes, source) ? "same" : "different";
}

async function both(read: ReadRange) {
  return {
    alpha: await outcome(read, "alpha", ALPHA),
    beta: await outcome(read, "beta", BETA),
  };
}

type Fetch = RangeFetch;

/** The first byte a `Range: bytes=<start>-<end>` header asks for. */
function rangeStart(init: Parameters<Fetch>[1]): number {
  return Number(/^bytes=(\d+)-/u.exec(init.headers.Range)?.[1]);
}

/**
 * Android's answer: 206 from the start of the range, and a body that runs to
 * the end of the file.
 */
function toEndOfFile(pack: Uint8Array<ArrayBuffer>): Fetch {
  return async (_url, init) => {
    const start = rangeStart(init);
    return new Response(new Blob([pack.subarray(start)]).stream(), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${pack.length - 1}/${pack.length}`,
      },
    });
  };
}

/**
 * Desktop Obsidian's answer: 200 with the bytes of the range as the body, and
 * no `Content-Range`.
 */
function rangeAs200(pack: Uint8Array<ArrayBuffer>): Fetch {
  return async (_url, init) => {
    const [, start, end] = /^bytes=(\d+)-(\d+)$/u.exec(init.headers.Range)!;
    return new Response(
      new Blob([pack.subarray(Number(start), Number(end) + 1)]).stream(),
      { status: 200 },
    );
  };
}

/** iOS's answer: 200 with the full file, the header ignored. */
function fullFile(pack: Uint8Array<ArrayBuffer>): Fetch {
  return async () => new Response(new Blob([pack]).stream(), { status: 200 });
}

export interface ContainerCase {
  readonly name: string;
  readonly run: () => Promise<unknown>;
  readonly expected: unknown;
}

export const cases: readonly ContainerCase[] = [
  {
    name: "reads every entry back byte for byte after Obsidian's install-time changes",
    run: async () => {
      const shipped = text(await fixturePack());
      const installed = applyObsidianInstall(
        `${shipped}//# sourceMappingURL=data:application/json;base64,e30=\n`,
      );
      return {
        tail: installed.endsWith("\n/* nosourcemap */"),
        sourceMapLine: installed.includes("sourceMappingURL"),
        ...(await both(bytesRange(bytesOf(installed)))),
      };
    },
    expected: { tail: true, sourceMapLine: false, alpha: "same", beta: "same" },
  },
  {
    name: "states the compatibility integer and each entry's name, offset, length and SHA-256 on line 1",
    run: async () => {
      const pack = await fixturePack();
      const index = parseIndex(pack.subarray(0, PACK_INDEX_BYTES));
      return {
        firstLineBytes: pack.indexOf(0x0a) + 1,
        compat: index?.compat,
        names: index?.entries.map((entry) => entry.name),
        hashesOfTheNamedRanges: await Promise.all(
          (index?.entries ?? []).map(
            async (entry) =>
              (await sha256(
                pack.slice(entry.offset, entry.offset + entry.length),
              )) === entry.sha256,
          ),
        ),
      };
    },
    expected: {
      firstLineBytes: 4096,
      compat: 1,
      names: ["alpha", "beta"],
      hashesOfTheNamedRanges: [true, true],
    },
  },
  {
    name: "is a script that exports an empty Obsidian plugin class",
    run: async () => {
      class Plugin {}
      const module: { exports: unknown } = { exports: {} };
      // oxlint-disable-next-line typescript/no-implied-eval, no-new-func -- the case proves that the pack text runs as the CommonJS module Obsidian loads
      new Function("require", "module", "exports", text(await fixturePack()))(
        (id: string) => (id === "obsidian" ? { Plugin } : undefined),
        module,
        module.exports,
      );
      const exported = module.exports;
      return {
        extendsPlugin:
          typeof exported === "function" &&
          exported.prototype instanceof Plugin,
        ownMembers:
          typeof exported === "function"
            ? Object.getOwnPropertyNames(exported.prototype)
            : null,
      };
    },
    expected: { extendsPlugin: true, ownMembers: ["constructor"] },
  },
  {
    name: "refuses bytes that differ from the pin",
    run: () =>
      writePack({
        entries: [{ name: "alpha", bytes: ALPHA, sha256: "0".repeat(64) }],
      }).then(
        () => "written",
        (error: unknown) => (error instanceof Error ? error.message : "thrown"),
      ),
    expected: `The bytes of "alpha" hash to 07b86ba2ac4bb438e4fecf504b3ccd0dbd338c12ae0322dee4dbeb2f05b8036d, and its pin is ${"0".repeat(64)}`,
  },
  {
    name: "refuses an entry with a changed byte as damaged, and reads the other entry",
    run: async () => {
      const pack = await fixturePack();
      const beta = parseIndex(pack.subarray(0, PACK_INDEX_BYTES))!.entries[1]!;
      const at = beta.offset + 1000;
      pack[at] = pack[at] === 0x41 ? 0x42 : 0x41;
      return both(bytesRange(pack));
    },
    expected: { alpha: "same", beta: "entry-damaged" },
  },
  {
    name: "refuses a pack with converted line endings as damaged",
    run: async () =>
      both(
        bytesRange(bytesOf(text(await fixturePack()).replaceAll("\n", "\r\n"))),
      ),
    expected: { alpha: "entry-damaged", beta: "entry-damaged" },
  },
  {
    name: "refuses a pack cut short by a sync tool as damaged",
    run: async () => {
      const pack = await fixturePack();
      return both(bytesRange(pack.slice(0, pack.length - 200_000)));
    },
    expected: { alpha: "same", beta: "entry-damaged" },
  },
  {
    name: "tells a pack that is too old from one that is too new",
    run: async () => ({
      lower: await outcome(bytesRange(await fixturePack(0)), "alpha", ALPHA),
      higher: await outcome(bytesRange(await fixturePack(2)), "alpha", ALPHA),
    }),
    expected: { lower: "pack-outdated", higher: "plugin-outdated" },
  },
  {
    name: "reports an entry the pack does not hold as missing",
    run: async () =>
      outcome(bytesRange(await fixturePack()), "pandoc-engine", ALPHA),
    expected: "entry-missing",
  },
  {
    name: "reports a file that is not a pack, and a read that fails, as unreadable",
    run: async () => ({
      otherPlugin: await outcome(
        bytesRange(bytesOf("module.exports = class {};\n".repeat(400))),
        "alpha",
        ALPHA,
      ),
      emptyFile: await outcome(bytesRange(new Uint8Array()), "alpha", ALPHA),
      failedRead: await outcome(
        () => Promise.reject(new Error("EIO")),
        "alpha",
        ALPHA,
      ),
      serverError: await outcome(
        fetchRange("pack", async () => new Response(null, { status: 500 })),
        "alpha",
        ALPHA,
      ),
    }),
    expected: {
      otherPlugin: "pack-unreadable",
      emptyFile: "pack-unreadable",
      failedRead: "pack-unreadable",
      serverError: "pack-unreadable",
    },
  },
  {
    name: "reports a pack file the host does not find as absent",
    run: async () =>
      outcome(
        fetchRange("pack", async () => new Response(null, { status: 404 })),
        "alpha",
        ALPHA,
      ),
    expected: "pack-absent",
  },
  {
    name: "gives the same bytes from a 206 answer that runs to the end of the file, from a 200 answer with the full file, and from a 200 answer with the range",
    run: async () => {
      const pack = bytesOf(applyObsidianInstall(text(await fixturePack())));
      return {
        toEndOfFile: await both(fetchRange("pack", toEndOfFile(pack))),
        fullFile: await both(fetchRange("pack", fullFile(pack))),
        rangeAs200: await both(fetchRange("pack", rangeAs200(pack))),
      };
    },
    expected: {
      toEndOfFile: { alpha: "same", beta: "same" },
      fullFile: { alpha: "same", beta: "same" },
      rangeAs200: { alpha: "same", beta: "same" },
    },
  },
  {
    name: "reads through the host's own fetch",
    run: async () => {
      const url = URL.createObjectURL(new Blob([await fixturePack()]));
      try {
        return await both(fetchRange(url));
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    expected: { alpha: "same", beta: "same" },
  },
];

/** The Electron renderer entry: every case's outcome, by name. */
export async function run(): Promise<Record<string, unknown>> {
  const outcomes: Record<string, unknown> = {};
  for (const { name, run: runCase } of cases) outcomes[name] = await runCase();
  return outcomes;
}
