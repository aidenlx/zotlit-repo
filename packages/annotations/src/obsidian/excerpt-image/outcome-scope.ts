import { Effect } from "effect";

import type { ExcerptOutcome, PdfStamp } from "./service.ts";

export const EXCERPT_OUTCOME_BYTES = 32 * 1024 * 1024;
export const EXCERPT_OUTCOME_ENTRIES = 256;

type OutcomeVerdict = "validated" | "fallback" | "failure";

interface RetainedOutcome {
  verdict: OutcomeVerdict;
  pdf: PdfStamp | null;
  bytes: number;
  outcome: ExcerptOutcome;
}

export interface ExcerptOutcomeScopeDiagnostics {
  retained: number;
  bytes: number;
  peakBytes: number;
  failures: number;
  fallbacks: number;
  hits: number;
  misses: number;
  consumers: number;
  released: boolean;
}

function stillFresh(
  retained: PdfStamp | null,
  current: PdfStamp | undefined,
): boolean {
  if (!current) return true;
  return (
    retained !== null &&
    retained.size === current.size &&
    retained.mtimeMs === current.mtimeMs
  );
}

function verdictOf(outcome: ExcerptOutcome): OutcomeVerdict {
  if (outcome.kind === "unavailable") return "failure";
  return outcome.provenance === "zotero" ? "fallback" : "validated";
}

export class ExcerptOutcomeScope implements AsyncDisposable {
  readonly #bytesLimit: number;
  readonly #entryLimit: number;
  readonly #entries = new Map<string, RetainedOutcome>();
  #bytes = 0;
  #peakBytes = 0;
  #hits = 0;
  #misses = 0;
  #consumers = 0;
  #released = false;
  #settled: PromiseWithResolvers<void> | undefined;

  constructor(limits: { bytes?: number; entries?: number } = {}) {
    this.#bytesLimit = limits.bytes ?? EXCERPT_OUTCOME_BYTES;
    this.#entryLimit = limits.entries ?? EXCERPT_OUTCOME_ENTRIES;
  }

  get diagnostics(): ExcerptOutcomeScopeDiagnostics {
    let failures = 0;
    let fallbacks = 0;
    for (const record of this.#entries.values()) {
      if (record.verdict === "failure") failures += 1;
      else if (record.verdict === "fallback") fallbacks += 1;
    }
    return {
      retained: this.#entries.size,
      bytes: this.#bytes,
      peakBytes: this.#peakBytes,
      failures,
      fallbacks,
      hits: this.#hits,
      misses: this.#misses,
      consumers: this.#consumers,
      released: this.#released,
    };
  }

  get(key: string, pdf?: PdfStamp): ExcerptOutcome | undefined {
    const record = this.#entries.get(key);
    if (!record) {
      this.#misses += 1;
      return undefined;
    }
    if (!stillFresh(record.pdf, pdf)) {
      this.#drop(key);
      this.#misses += 1;
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, record);
    this.#hits += 1;
    return record.outcome;
  }

  retain(
    key: string,
    pdf: PdfStamp | null | undefined,
    outcome: ExcerptOutcome,
  ): void {
    if (this.#released) return;
    const bytes = outcome.kind === "available" ? outcome.bytes.length : 0;
    if (bytes > this.#bytesLimit) return;
    this.#drop(key);
    this.#entries.set(key, {
      verdict: verdictOf(outcome),
      pdf: pdf ?? null,
      bytes,
      outcome,
    });
    this.#bytes += bytes;
    for (const oldest of this.#entries.keys()) {
      if (
        this.#entries.size <= this.#entryLimit &&
        this.#bytes <= this.#bytesLimit
      )
        break;
      this.#drop(oldest);
    }
    this.#peakBytes = Math.max(this.#peakBytes, this.#bytes);
  }

  admit(): Disposable {
    this.#consumers += 1;
    return {
      [Symbol.dispose]: () => {
        this.#consumers -= 1;
        if (this.#consumers === 0) this.#settled?.resolve();
      },
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    if (this.#consumers > 0) {
      this.#settled = Promise.withResolvers<void>();
      await this.#settled.promise;
    }
    this.#dropAll();
  }

  #drop(key: string): void {
    const record = this.#entries.get(key);
    if (!record) return;
    this.#entries.delete(key);
    this.#bytes -= record.bytes;
  }

  #dropAll(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

export const outcomeScope = (provided: ExcerptOutcomeScope | undefined) =>
  provided === undefined
    ? Effect.acquireDisposable(Effect.sync(() => new ExcerptOutcomeScope()))
    : Effect.succeed(provided);
