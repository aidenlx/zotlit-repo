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
    const sampleMs = 40;
    for (const source of sources) {
      for (let warmup = 0; warmup < 10; warmup++) {
        expect(scanNote(source).wikilinks.map((link) => link.raw)).toEqual(
          links,
        );
      }
    }
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
    const minimums = samples.map((times) => Math.min(...times));
    const last = minimums.length - 1;
    expect(
      minimums[last]! / minimums[0]!,
      `${counts[0]} → ${counts[last]} openers: ${minimums[0]} → ${minimums[last]} ms`,
    ).toBeLessThan(20);
  },
  60_000,
);
