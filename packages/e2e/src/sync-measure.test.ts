import { describe, expect, it } from "vitest";

import type { LastApply, ReadSample, SyncSample } from "./sync-measure.ts";
import { isSyncEnd, measureSync, statusAnswerOver } from "./sync-measure.ts";

const earlier: LastApply = {
  sequence: 3,
  beganAt: 100,
  committedAt: 150,
  applyMillis: 50,
  closedMillis: 55,
};
const latest: LastApply = {
  sequence: 4,
  beganAt: 1_000,
  committedAt: 1_240,
  applyMillis: 240,
  closedMillis: 250,
};
const trigger = { at: 400, sequence: 3 };

const status = (
  [start, ms]: readonly [number, number],
  syncing: boolean | null,
  lastApply: LastApply | null,
): SyncSample => ({ start, end: start + ms, ok: true, syncing, lastApply });

const failed = ([start, ms]: readonly [number, number]): SyncSample => ({
  start,
  end: start + ms,
  ok: false,
  syncing: null,
  lastApply: null,
});

const read = (start: number, end: number, ok = true): ReadSample => ({
  start,
  end,
  ok,
});

describe("the sync measurement", () => {
  const samples = [
    status([300, 5], false, earlier),
    status([500, 5], true, earlier),
    status([700, 5], true, earlier),
    status([900, 400], true, earlier),
    failed([1_305, 3]),
    status([1_315, 4], false, latest),
    status([1_520, 4], false, latest),
  ];

  it("ends at the first answer after the trigger that shows a new apply and no sync", () => {
    expect(samples.map((sample) => isSyncEnd(sample, trigger))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("takes the apply time and the read wait from the store, and counts the successful status answers that overlap the apply, also one that waits across it", () => {
    expect(
      measureSync(
        samples,
        [read(450, 470), read(990, 1_250), read(1_120, 1_130, false)],
        trigger,
      ),
    ).toEqual({
      applies: 1,
      applyMs: 240,
      readWaitMs: 250,
      syncMs: 919,
      statusPollMs: 200,
      statusAnswersInApply: 1,
      statusAnswerMaxMs: 400,
      statusAnswerP95Ms: 400,
      statusCoverage: "measured",
      readsInApply: 1,
      readsFailed: 1,
      longestReadMs: 260,
    });
  });

  it("fails when no successful status answer overlaps an apply longer than one poll", () => {
    const blind = samples.filter((sample) => sample.start !== 900);
    expect(() => measureSync(blind, [], trigger)).toThrow(
      "No successful status answer overlapped the apply of 240 ms",
    );
  });

  it("accepts a missing status answer only for an apply shorter than one poll, and says so", () => {
    const short = { ...latest, applyMillis: 30, committedAt: 1_030 };
    const measure = measureSync(
      [
        status([300, 5], false, earlier),
        status([800, 5], true, earlier),
        status([1_300, 5], false, short),
      ],
      [],
      trigger,
    );
    expect(measure).toMatchObject({
      statusAnswerMaxMs: null,
      statusCoverage: "apply shorter than one poll",
    });
    expect(statusAnswerOver(measure, 50)).toBeNull();
  });

  it("fails when a status request that overlaps a short apply fails, rather than calling it a missed poll", () => {
    const short = { ...latest, applyMillis: 30, committedAt: 1_030 };
    expect(() =>
      measureSync(
        [
          status([300, 5], false, earlier),
          status([800, 5], true, earlier),
          failed([1_010, 30]),
          status([1_300, 5], false, short),
        ],
        [],
        trigger,
      ),
    ).toThrow("A status request failed during the apply");
  });

  it("ends the sync when the answer that shows it ended arrives", () => {
    const apply = {
      sequence: 4,
      beganAt: 20,
      committedAt: 110,
      applyMillis: 90,
      closedMillis: 92,
    };
    expect(
      measureSync(
        [status([0, 5], true, earlier), status([80, 35], false, apply)],
        [],
        { at: 0, sequence: 3 },
      ),
    ).toMatchObject({ syncMs: 115, statusAnswerMaxMs: 35 });
  });

  it("starts a sync that something outside the probe began at the last answer before the first answer that shows it", () => {
    const first = { ...latest, sequence: 1, beganAt: 250, committedAt: 300 };
    expect(
      measureSync(
        [
          failed([0, 5]),
          status([100, 5], false, null),
          status([200, 60], true, null),
          status([400, 5], false, first),
        ],
        [],
        { at: null, sequence: 0 },
      ),
    ).toMatchObject({ applies: 1, syncMs: 305 });
  });

  it("names the longest status answer and the limit when the answer is over the limit", () => {
    const measure = measureSync(samples, [], trigger);
    expect(statusAnswerOver(measure, 500)).toBeNull();
    expect(statusAnswerOver(measure, 50)).toEqual({
      statusAnswerMaxMs: 400,
      limitMs: 50,
    });
  });

  it("refuses a measurement when no new apply came after the trigger", () => {
    expect(() => measureSync(samples.slice(0, 5), [], trigger)).toThrow(
      "No status answer showed a new apply",
    );
  });
});
