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
  const sampleMs = 40;
  for (const [index, source] of sources.entries()) {
    for (let warmup = 0; warmup < 10; warmup++) {
      expect(scanPandocCitations(source)).toHaveLength(counts[index]!);
    }
  }
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
  const minimums = samples.map((times) => Math.min(...times));
  const last = minimums.length - 1;
  expect(
    minimums[last]! / minimums[0]!,
    `${counts[0]} → ${counts[last]} Citations: ${minimums[0]} → ${minimums[last]} ms`,
  ).toBeLessThan(20);
}, 60_000);
