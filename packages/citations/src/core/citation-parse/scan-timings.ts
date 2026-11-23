import type { ParseRequest } from "./client.ts";

export interface ScanTimings {
  intakeMs: number;
  requestMs: number;
  encodeMs: number;
  postMs: number;
  receiveMs: number;
  decodeMs: number;
  compareMs: number;
  updateMs: number;
  persistMs: number;
  applyMs: number;
}

interface MeasuredScan {
  readonly generation: number;
  readonly timings: ScanTimings;
  readonly now: () => number;
  requestAt: number;
  replyAt: number;
  finish(): void;
}

interface ScanObservation {
  readonly now: () => number;
  readonly publish: (timings: ScanTimings) => void;
  scan?: MeasuredScan;
}

const observations = new Map<string, ScanObservation>();

export function observeScanTimings(
  path: string,
  now: () => number,
  publish: (timings: ScanTimings) => void,
): Disposable {
  const observation: ScanObservation = { now, publish };
  observations.set(path, observation);
  return {
    [Symbol.dispose]() {
      if (observations.get(path) === observation) observations.delete(path);
    },
  };
}

export function beginMeasuredScan(
  path: string,
  generation: number,
): MeasuredScan | undefined {
  const observation = observations.get(path);
  if (!observation) return undefined;
  const timings: ScanTimings = {
    intakeMs: 0,
    requestMs: 0,
    encodeMs: 0,
    postMs: 0,
    receiveMs: 0,
    decodeMs: 0,
    compareMs: 0,
    updateMs: 0,
    persistMs: 0,
    applyMs: 0,
  };
  const scan: MeasuredScan = {
    generation,
    requestAt: 0,
    replyAt: 0,
    timings,
    now: observation.now,
    finish() {
      if (!scan.replyAt) return;
      timings.applyMs = scan.now() - scan.replyAt;
      observation.publish(timings);
    },
  };
  observation.scan = scan;
  return scan;
}

export function observedScan(path: string): MeasuredScan | undefined {
  return observations.get(path)?.scan;
}

export function measuredScan({ path, generation }: ParseRequest) {
  const scan = observedScan(path);
  return scan?.generation === generation ? scan : undefined;
}

export function scanMeasurementClock(
  path?: string,
): (() => number) | undefined {
  const observation =
    path === undefined
      ? observations.values().next().value
      : observations.get(path);
  return observation?.now;
}

export function isMeasuringScans(): boolean {
  return observations.size > 0;
}
