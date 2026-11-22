import { createContext } from "react";

export interface LessonStepMeta {
  title: string;
  alt: string;
}

export interface LessonState {
  media: string;
  steps: LessonStepMeta[];
  live: {
    open: number | null;
    ticks: ReadonlySet<number>;
    tick: (n: number, done: boolean) => number;
    toggle: (n: number) => void;
    go: (n: number) => void;
    wide: boolean;
    launched: number | null;
  } | null;
}

export const LessonContext = createContext<LessonState | null>(null);

export function partFromHash(hash: string, total: number): number {
  const value = hash.replace(/^#/, "");
  if (value === "done") return total + 1;
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= total ? step : 0;
}

export function openOnLoad(
  hash: string,
  ticks: readonly number[],
  total: number,
): number | null {
  const part = partFromHash(hash, total);
  if (part >= 1 && part <= total) return part;
  if (part > total || ticks.length === 0) return null;
  return firstOpenStep(ticks, total) ?? null;
}

export interface LessonProgress {
  ticks: number[];
  done: boolean;
}

const storageKey = "zotlit:learn-progress";

function toProgress(value: unknown): LessonProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as { ticks?: unknown; done?: unknown };
  const ticks = Array.isArray(entry.ticks)
    ? entry.ticks.filter((n): n is number => Number.isInteger(n) && n >= 1)
    : [];
  return { ticks, done: entry.done === true };
}

export function readProgress(): Record<string, LessonProgress> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!value || typeof value !== "object") return {};
    const all: Record<string, LessonProgress> = {};
    for (const [slug, entry] of Object.entries(value)) {
      const progress = toProgress(entry);
      if (progress) all[slug] = progress;
    }
    return all;
  } catch {
    return {};
  }
}

export function saveTicks(
  slug: string,
  ticks: Iterable<number>,
  total: number,
) {
  try {
    const all = readProgress();
    const sorted = [...ticks].toSorted((a, b) => a - b);
    all[slug] = {
      ticks: sorted,
      done: (all[slug]?.done ?? false) || sorted.length >= total,
    };
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    // Without storage the lesson still works; it only forgets the ticks.
  }
}

export function nextOpenStep(
  ticks: ReadonlySet<number>,
  n: number,
  total: number,
) {
  for (let k = n + 1; k <= total; k++) if (!ticks.has(k)) return k;
  return firstOpenStep(ticks, total);
}

export function firstOpenStep(ticks: Iterable<number>, total: number) {
  const done = new Set(ticks);
  for (let n = 1; n <= total; n++) if (!done.has(n)) return n;
  return undefined;
}
