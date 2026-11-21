// The default `ReadRange`, for every host: `fetch` of the pack file's resource
// URL with a `Range` header. Hosts answer the header in four ways, and each
// gives the same bytes here:
//
//   206 with the range                    read the body;
//   206 from the start to the file's end  (Android) read `length` bytes, cancel;
//   200 with the range                    (desktop Obsidian) read the body;
//   200 with the full file                (iOS) pass `offset` bytes, read `length`.
//
// A 200 answer does not state which of the two it is. Its body is the range
// when it ends within `length` bytes, and the full file when it runs on.
import type { ReadRange } from "#reader.ts";

import { PackAbsentError } from "#reader.ts";

/** The part of `fetch` that the capability calls. */
export type RangeFetch = (
  url: string,
  init: { readonly headers: { readonly Range: string } },
) => Promise<Response>;

/**
 * The first bytes of `body`, up to `limit` or a little more: the read stops at
 * the chunk that reaches `limit`, and the rest of the body is cancelled.
 */
async function readUpTo(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel();
  const bytes = new Uint8Array(total);
  let filled = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, filled);
    filled += chunk.length;
  }
  return bytes;
}

/**
 * A `ReadRange` over the file at `url`.
 *
 * @param fetch the host's `fetch`; a test gives a server's answer.
 */
export function fetchRange(
  url: string,
  fetch: RangeFetch = globalThis.fetch,
): ReadRange {
  return async (offset, length) => {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (response.status === 404) {
      throw new PackAbsentError(`No pack file at ${url}`);
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`The pack file answered ${response.status}`);
    }
    if (!response.body) return new Uint8Array();
    if (response.status === 206) {
      return (await readUpTo(response.body, length)).subarray(0, length);
    }
    const bytes = await readUpTo(response.body, offset + length);
    return bytes.length <= length
      ? bytes
      : bytes.subarray(offset, offset + length);
  };
}
