// Same harness shape as packages/citations/src/core/citation-index/scan-note-scaling.test.ts:
// keep the two in step. A shared helper would need a new export from a production package.
import { expect, it } from "vitest";

import { scanPandocCitations } from "./pandoc-citation.ts";

it("scans dense Pandoc Citations in linear time", () => {
  const counts = [1_000, 2_000, 4_000, 8_000];
  const sources = counts.map((count) =>
    "[@normal] @author [p. 3; -@other] `@code` [^@note] [@link](url)\n".repeat(
      count / 2,
    ),
  );
  const samples = sources.map(() => [] as number[]);
  const sampleCount = 21;
  // The thread CPU clock can tick in whole milliseconds or coarser (Linux CI
  // runners), so a scan of the smallest size can read as 0 ms. Each sample
  // repeats the scan until it has used this much CPU time.
  const sampleMs = 40;
  for (const [index, source] of sources.entries()) {
    for (let warmup = 0; warmup < 10; warmup++) {
      expect(scanPandocCitations(source)).toHaveLength(counts[index]!);
    }
  }
  // Batch scans and alternate size order so timer noise and host load do not
  // favor one size.
  const indices = [0, 1, 2, 3];
  for (let sample = 0; sample < sampleCount; sample++) {
    for (const index of indices) {
      let citationCount = 0;
      let scans = 0;
      let elapsedMs = 0;
      const start = process.threadCpuUsage();
      while (elapsedMs < sampleMs) {
        citationCount += scanPandocCitations(sources[index]!).length;
        scans++;
        const { user, system } = process.threadCpuUsage(start);
        elapsedMs = (user + system) / 1000;
      }
      samples[index]!.push(elapsedMs / scans);
      expect(citationCount).toBe(counts[index]! * scans);
    }
    indices.reverse();
  }
  // Machine load only adds time to a sample, so the fastest sample of each size
  // is the most stable estimate.
  const minimums = samples.map((times) => Math.min(...times));
  // Compare the smallest size with the largest, 8 times as many Citations:
  // linear growth takes about 8 times as long, quadratic about 64 times. A
  // bound between them stays far from both, where a bound on each doubling
  // (2 against 4) failed under load. Only the upper bound: fixed overhead, JIT
  // and GC can make growth sub-linear.
  const last = minimums.length - 1;
  expect(
    minimums[last]! / minimums[0]!,
    `${counts[0]} → ${counts[last]} Citations: ${minimums[0]} → ${minimums[last]} ms`,
  ).toBeLessThan(20);
}, 60_000);
