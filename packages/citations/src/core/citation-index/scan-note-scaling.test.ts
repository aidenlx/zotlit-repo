// Unmatched math openers must not repeatedly scan the paragraph suffix.
// Same harness shape as packages/templates/src/pandoc-citation-scaling.test.ts: keep the two in step.
import { expect, it } from "vitest";

import { scanNote } from "./scan-note.ts";

it.each([
  {
    name: "unmatched inline openers",
    source: (count: number) => `${"$x ".repeat(count)}[[Note]]`,
    links: ["Note"],
  },
  {
    name: "invalid display closer runs",
    source: (count: number) => `$$\n${"$".repeat(count)} x\n[[Note]]`,
    links: [],
  },
])(
  "scans $name in linear time",
  ({ source, links }) => {
    const counts = [2_000, 4_000, 8_000, 16_000];
    const sources = counts.map(source);
    const samples = sources.map(() => [] as number[]);
    const sampleCount = 21;
    // The thread CPU clock can tick in whole milliseconds or coarser (Linux
    // CI runners), so a scan of the smallest size can read as 0 ms. Each
    // sample repeats the scan until it has used this much CPU time.
    const sampleMs = 40;
    for (const source of sources) {
      for (let warmup = 0; warmup < 10; warmup++) {
        expect(scanNote(source).wikilinks.map((link) => link.raw)).toEqual(
          links,
        );
      }
    }
    // Alternate size order to distribute host load across sizes.
    const indices = [0, 1, 2, 3];
    for (let sample = 0; sample < sampleCount; sample++) {
      for (const index of indices) {
        let linkCount = 0;
        let scans = 0;
        let elapsedMs = 0;
        const start = process.threadCpuUsage();
        while (elapsedMs < sampleMs) {
          linkCount += scanNote(sources[index]!).wikilinks.length;
          scans++;
          const { user, system } = process.threadCpuUsage(start);
          elapsedMs = (user + system) / 1000;
        }
        samples[index]!.push(elapsedMs / scans);
        expect(linkCount).toBe(links.length * scans);
      }
      indices.reverse();
    }
    // Machine load only adds time to a sample, so the fastest sample of each
    // size is the most stable estimate.
    const minimums = samples.map((times) => Math.min(...times));
    // Compare the smallest size with the largest, 8 times as many openers:
    // linear growth takes about 8 times as long, quadratic about 64 times. A
    // bound between them stays far from both, where a bound on each doubling
    // (2 against 4) failed under load.
    const last = minimums.length - 1;
    expect(
      minimums[last]! / minimums[0]!,
      `${counts[0]} → ${counts[last]} openers: ${minimums[0]} → ${minimums[last]} ms`,
    ).toBeLessThan(20);
  },
  60_000,
);
