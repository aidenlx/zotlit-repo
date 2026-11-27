export interface LastApply {
  readonly sequence: number;
  readonly beganAt: number;
  readonly committedAt: number;
  readonly applyMillis: number;
  readonly closedMillis: number;
}

export interface SyncSample {
  readonly start: number;
  readonly end: number;
  readonly ok: boolean;
  readonly syncing: boolean | null;
  readonly lastApply: LastApply | null;
}

export interface ReadSample {
  readonly start: number;
  readonly end: number;
  readonly ok: boolean;
}

export interface SyncTrigger {
  readonly at: number | null;
  readonly sequence: number;
}

export interface SyncMeasure {
  readonly applies: number;
  readonly applyMs: number;
  readonly readWaitMs: number;
  readonly syncMs: number;
  readonly statusPollMs: number;
  readonly statusAnswersInApply: number;
  readonly statusAnswerMaxMs: number | null;
  readonly statusAnswerP95Ms: number | null;
  readonly statusCoverage: "measured" | "apply shorter than one poll";
  readonly readsInApply: number;
  readonly readsFailed: number;
  readonly longestReadMs: number | null;
}

export function isSyncEnd(sample: SyncSample, trigger: SyncTrigger): boolean {
  return (
    sample.ok &&
    sample.start >= (trigger.at ?? -Infinity) &&
    sample.syncing === false &&
    (sample.lastApply?.sequence ?? 0) > trigger.sequence
  );
}

const percentile = (values: readonly number[], share: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * share))
  ]!;
};

const overlaps = (
  span: { readonly start: number; readonly end: number },
  from: number,
  to: number,
) => span.start <= to && span.end >= from;

export function measureSync(
  samples: readonly SyncSample[],
  reads: readonly ReadSample[],
  trigger: SyncTrigger,
): SyncMeasure {
  const end = samples.find((sample) => isSyncEnd(sample, trigger));
  if (!end)
    throw new Error("No status answer showed a new apply after the sync");
  const apply = end.lastApply!;
  const firstSyncing = samples.findIndex(
    (sample) => sample.ok && sample.syncing,
  );
  const startAt =
    trigger.at ?? samples[Math.max(0, firstSyncing - 1)]?.start ?? end.start;
  if (
    samples.some(
      (sample) =>
        !sample.ok && overlaps(sample, apply.beganAt, apply.committedAt),
    )
  )
    throw new Error("A status request failed during the apply");
  const answers = samples
    .filter(
      (sample) =>
        sample.ok && overlaps(sample, apply.beganAt, apply.committedAt),
    )
    .map((sample) => sample.end - sample.start);
  const gaps = samples
    .slice(1)
    .map((sample, index) => sample.start - samples[index]!.start);
  const statusPollMs = gaps.length === 0 ? 0 : percentile(gaps, 0.5);
  if (answers.length === 0 && apply.applyMillis >= statusPollMs)
    throw new Error(
      `No successful status answer overlapped the apply of ${Math.round(apply.applyMillis)} ms, with a status answer about every ${Math.round(statusPollMs)} ms`,
    );
  const inSync = reads.filter(
    (read) => read.ok && overlaps(read, startAt, end.end),
  );
  return {
    applies: apply.sequence - trigger.sequence,
    applyMs: Math.round(apply.applyMillis),
    readWaitMs: Math.round(apply.closedMillis),
    syncMs: Math.round(end.end - startAt),
    statusPollMs: Math.round(statusPollMs),
    statusAnswersInApply: answers.length,
    statusAnswerMaxMs:
      answers.length === 0 ? null : Math.round(Math.max(...answers)),
    statusAnswerP95Ms:
      answers.length === 0 ? null : Math.round(percentile(answers, 0.95)),
    statusCoverage:
      answers.length === 0 ? "apply shorter than one poll" : "measured",
    readsInApply: reads.filter(
      (read) => read.ok && overlaps(read, apply.beganAt, apply.committedAt),
    ).length,
    readsFailed: reads.filter((read) => !read.ok).length,
    longestReadMs:
      inSync.length === 0
        ? null
        : Math.round(Math.max(...inSync.map((read) => read.end - read.start))),
  };
}

export function statusAnswerOver(
  measure: SyncMeasure,
  limitMs: number,
): { readonly statusAnswerMaxMs: number; readonly limitMs: number } | null {
  return measure.statusAnswerMaxMs !== null &&
    measure.statusAnswerMaxMs > limitMs
    ? { statusAnswerMaxMs: measure.statusAnswerMaxMs, limitMs }
    : null;
}
