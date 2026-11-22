import type { ReadRange } from "#reader.ts";

import { PackAbsentError } from "#reader.ts";

export type RangeFetch = (
  url: string,
  init: { readonly headers: { readonly Range: string } },
) => Promise<Response>;

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

export interface FetchRangeOptions {
  readonly fetch?: RangeFetch;
}

export function fetchRange(
  url: string,
  { fetch = globalThis.fetch }: FetchRangeOptions = {},
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
