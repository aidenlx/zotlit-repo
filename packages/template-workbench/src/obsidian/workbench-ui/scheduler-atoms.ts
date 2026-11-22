import type { RenderRequest } from "#core/render/request.ts";
import type {
  TemplateRenderResult,
  RenderDiagnostic,
  RenderedProperty,
  RenderIdentity,
} from "#core/render/result.ts";
import { Cause, Effect, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { CitationPreviewSelection } from "@zotlit/notes/core/template-preview/citation-examples.ts";
import type { PartialPreviewSelection } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
import type { WorkbenchReportContext } from "@zotlit/notes/core/template/render-report.ts";
import {
  captureRenderReport,
  engineEvidence,
} from "@zotlit/notes/core/template/render-report.ts";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { WorkbenchHostError } from "./host.tsx";
import type { PreviewMode } from "./model.ts";

import { followEntries } from "#core/document/manifest-patch.ts";
import {
  failedRender,
  renderFailed,
  retainOutputs,
  templateSourceRevision,
  renderIdentity,
} from "#core/render/result.ts";

export interface RenderSchedulerInput {
  readonly source: string;
  readonly document?: string;
  readonly mode: PreviewMode;
  readonly live: boolean;
  readonly snapshot: ItemSnapshot | null;
  readonly annotation?: AnnotationExample | null;
  readonly citation?: CitationPreviewSelection | null;
  readonly partial?: PartialPreviewSelection | null;
  readonly hold?: boolean | "invalid";
}

export type RenderTrigger = "explicit" | "automatic";

export interface RenderSchedulerState<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly result: R | null;
  readonly retained: R | null;
  readonly busy: boolean;
  readonly staleReason: "hold" | "invalid" | "demand" | "live" | null;
  readonly trigger: RenderTrigger | null;
  readonly attempt: number;
}

export function staleReasonFor(
  input: Pick<RenderSchedulerInput, "hold" | "live">,
  current: boolean,
): RenderSchedulerState["staleReason"] {
  if (input.hold === "invalid") return "invalid";
  if (input.hold === true) return "hold";
  if (current) return null;
  return input.live ? "live" : "demand";
}

export function rebased<R extends TemplateRenderResult>(
  result: R,
  from: string,
  to: string,
): R {
  if (
    from === to ||
    (result.properties.length === 0 &&
      result.fold.length === 0 &&
      result.diagnostics.every(({ position }) => position === undefined))
  )
    return result;
  const follow = followEntries(from, to);
  if (follow === null) return result;
  const move = (list: readonly RenderedProperty[]) =>
    list.flatMap((property) => {
      const position = follow(property.position);
      return position === undefined ? [] : [{ ...property, position }];
    });
  return {
    ...result,
    properties: move(result.properties),
    fold: move(result.fold),
    diagnostics: result.diagnostics.map((diagnostic) => {
      if (diagnostic.position === undefined) return diagnostic;
      const { position: _removed, ...unplaced } = diagnostic;
      const position = follow(diagnostic.position);
      return position === undefined ? unplaced : { ...diagnostic, position };
    }),
  };
}

export function rebaser<R extends TemplateRenderResult>() {
  let last: { result: R; to: string; out: R } | null = null;
  return (result: R | null, from: string, to: string): R | null => {
    if (result === null) return null;
    if (last?.result !== result || last.to !== to)
      last = { result, to, out: rebased(result, from, to) };
    return last.out;
  };
}

export function held(input: Pick<RenderSchedulerInput, "hold">): boolean {
  return input.hold === true || input.hold === "invalid";
}

export interface RenderSchedulerAtomsOptions<
  R extends TemplateRenderResult,
  Services = never,
  RuntimeError = never,
> {
  readonly runtime: Atom.AtomRuntime<Services, RuntimeError>;
  readonly input: Atom.Atom<RenderSchedulerInput>;
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError, Services>;
  readonly failed: (result: TemplateRenderResult) => R;
  readonly retain?: (kept: R, result: R) => R;
  readonly reportContext?: () => WorkbenchReportContext;
  readonly debounceMs?: number;
}

export interface RenderSchedulerAtoms<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly state: Atom.Atom<RenderSchedulerState<R>>;
  readonly run: Atom.Writable<void, void>;
  readonly pause: Atom.Writable<void, void>;
  readonly invalidate: Atom.Writable<void, void>;
  readonly fail: Atom.Writable<void, RenderDiagnostic>;
}

interface InputGeneration {
  readonly input: RenderSchedulerInput;
  readonly epoch: number;
  readonly generation: number;
  readonly cleared: number;
}

interface Job {
  readonly generation: number;
  readonly request: RenderRequest;
  readonly trigger: RenderTrigger;
}

interface Arrival<R extends TemplateRenderResult> {
  readonly published: R;
  readonly source: string;
  readonly trigger: RenderTrigger;
}

interface Failure<R extends TemplateRenderResult> extends Arrival<R> {
  readonly now: RenderSchedulerInput;
  readonly clearedNow: number;
}

interface Landing<R extends TemplateRenderResult> {
  readonly landed: Landed<R>;
  readonly rendered: Arrival<R> | undefined;
  readonly failure: Failure<R> | null;
}

interface Landed<R extends TemplateRenderResult> {
  readonly result: R | null;
  readonly source: string;
  readonly trigger: RenderTrigger | null;
  readonly attempt: number;
  readonly produced: R | null;
  readonly producedSource: string;
  readonly producedDocument: string | undefined;
  readonly cleared: number;
}

const RENDER_FIELDS = [
  "source",
  "document",
  "mode",
  "snapshot",
  "annotation",
  "citation",
  "partial",
  "hold",
] as const satisfies readonly (keyof RenderSchedulerInput)[];

function sameRenderInput(
  previous: RenderSchedulerInput,
  next: RenderSchedulerInput,
): boolean {
  return RENDER_FIELDS.every((field) => next[field] === previous[field]);
}

function nextRequest(input: RenderSchedulerInput): RenderRequest | null {
  const { snapshot, annotation, citation, partial } = input;
  if (held(input) || snapshot === null) return null;
  return {
    mode: input.mode,
    source: input.source,
    snapshot,
    ...(annotation ? { annotation } : {}),
    ...(citation ? { citation } : {}),
    ...(partial ? { partial } : {}),
  };
}

function sameSelection(
  input: RenderSchedulerInput,
  result: RenderIdentity,
): boolean {
  return !(
    (input.snapshot !== null &&
      result.snapshotRevision !== input.snapshot.revision) ||
    (input.annotation != null &&
      (result.annotationId !== input.annotation.id ||
        result.annotationRevision !== input.annotation.revision)) ||
    (input.citation != null &&
      (result.citationVariant !== input.citation.variant ||
        (result.citationExample ?? null) !== input.citation.example)) ||
    (input.partial != null &&
      (result.partialContext !== input.partial.context ||
        (result.partialProfile ?? null) !== input.partial.profile)) ||
    result.previewMode !== input.mode
  );
}

function sameState<R extends TemplateRenderResult>(
  a: RenderSchedulerState<R>,
  b: RenderSchedulerState<R>,
): boolean {
  return (
    a.result === b.result &&
    a.retained === b.retained &&
    a.busy === b.busy &&
    a.staleReason === b.staleReason &&
    a.trigger === b.trigger &&
    a.attempt === b.attempt
  );
}

export function makeRenderSchedulerAtoms<
  R extends TemplateRenderResult,
  Services = never,
  RuntimeError = never,
>({
  runtime,
  input,
  render,
  failed,
  retain = retainOutputs,
  reportContext,
  debounceMs = 300,
}: RenderSchedulerAtomsOptions<
  R,
  Services,
  RuntimeError
>): RenderSchedulerAtoms<R> {
  const epoch = Atom.make(0);
  const inputGeneration = Atom.make((get): InputGeneration => {
    const next = get(input);
    const at = get(epoch);
    const previous = Option.getOrUndefined(get.self<InputGeneration>());
    if (previous === undefined) {
      return { input: next, epoch: at, generation: 0, cleared: 0 };
    }
    const cleared = next !== previous.input && next.snapshot === null;
    const dropped =
      cleared ||
      at !== previous.epoch ||
      !sameRenderInput(previous.input, next) ||
      (!previous.input.live && next.live);
    return {
      input: next,
      epoch: at,
      generation: previous.generation + (dropped ? 1 : 0),
      cleared: previous.cleared + (cleared ? 1 : 0),
    };
  });
  const generation = Atom.map(inputGeneration, ({ generation }) => generation);
  const cleared = Atom.map(inputGeneration, ({ cleared }) => cleared);
  const live = Atom.map(input, ({ live }) => live);
  const cancelled = Atom.make(-1);
  const job = Atom.make<Job | null>(null);
  const failure = Atom.make<Failure<R> | null>(null);

  function stamp(result: R, trigger: RenderTrigger, sequence: number): R {
    if (result.diagnostics.every(({ report }) => report !== undefined)) {
      return result;
    }
    // oxlint-disable-next-line zotlit-services/temporal-in-effect -- stamped inside a synchronous atom read, which no Effect runs, so no Clock is in scope; the host-failure command lands here too.
    const capturedAt = Temporal.Now.instant().toString();
    const context = reportContext?.() ?? {};
    return {
      ...result,
      diagnostics: result.diagnostics.map((diagnostic) =>
        diagnostic.report === undefined
          ? {
              ...diagnostic,
              report: captureRenderReport({
                diagnostic,
                identity: result,
                trigger,
                sequence,
                capturedAt,
                context,
              }),
            }
          : diagnostic,
      ),
    };
  }

  function land(
    previous: Landed<R>,
    { published, source, trigger }: Arrival<R>,
    {
      now,
      clearedNow,
    }: {
      readonly now: RenderSchedulerInput;
      readonly clearedNow: number;
    },
  ): Landed<R> {
    const attempt = previous.attempt + 1;
    const result = stamp(published, trigger, attempt);
    const forRetention = result.diagnostics.some(
      ({ code }) => code === "property-error",
    )
      ? ({
          ...result,
          properties: [],
          fold: [],
          frontmatterBlock: null,
          creationBody: null,
          managedRegion: null,
          annotationRanges: [],
        } as R)
      : result;
    const keeps = !renderFailed(forRetention);
    return {
      result,
      source,
      trigger,
      attempt,
      produced: keeps
        ? previous.produced !== null &&
          previous.producedDocument === now.document
          ? retain(
              rebased(previous.produced, previous.producedSource, source),
              forRetention,
            )
          : forRetention
        : previous.produced,
      producedSource: keeps ? source : previous.producedSource,
      producedDocument: keeps ? now.document : previous.producedDocument,
      cleared: clearedNow,
    };
  }

  const quiet = runtime.atom((get) => {
    const at = get(generation);
    if (!get(live) || get(cancelled) === at) return Effect.void;
    const request = nextRequest(get.once(input));
    if (request === null) return Effect.void;
    return Effect.sleep(debounceMs).pipe(
      Effect.andThen(
        Atom.set(job, { generation: at, request, trigger: "automatic" }),
      ),
    );
  });

  const rendering = runtime.atom((get) => {
    const at = get(generation);
    const current = get(job);
    if (current === null || current.generation !== at)
      return Effect.succeed<Arrival<R> | undefined>(undefined);
    const { request, trigger } = current;
    return render(request).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        const failure = Cause.squash(cause);
        const error =
          failure instanceof WorkbenchHostError ? failure.cause : failure;
        return Effect.succeed(
          failed(
            failedRender(renderIdentity(request), {
              code: "render-error",
              message: error instanceof Error ? error.message : String(error),
              evidence: engineEvidence(error),
              part: "render",
            }),
          ),
        );
      }),
      Effect.map((published): Arrival<R> => ({
        published,
        source: request.source,
        trigger,
      })),
    );
  });

  const landing = Atom.make((get): Landing<R> => {
    const previous = Option.getOrElse(
      get.self<Landing<R>>(),
      (): Landing<R> => ({
        landed: {
          result: null,
          source: "",
          trigger: null,
          attempt: 0,
          produced: null,
          producedSource: "",
          producedDocument: undefined,
          cleared: 0,
        },
        rendered: undefined,
        failure: null,
      }),
    );
    const rendered = Option.getOrUndefined(AsyncResult.value(get(rendering)));
    const reported = get(failure);
    let { landed } = previous;
    if (rendered !== undefined && rendered !== previous.rendered)
      landed = land(landed, rendered, {
        now: get.once(input),
        clearedNow: get.once(cleared),
      });
    if (reported !== null && reported !== previous.failure)
      landed = land(landed, reported, reported);
    return { landed, rendered, failure: reported };
  });
  const landed = Atom.map(landing, (state) => state.landed);

  const shownResult = rebaser<R>();
  const shownRetained = rebaser<R>();
  const state = Atom.make((get): RenderSchedulerState<R> => {
    get(quiet);
    const now = get(input);
    const busy = AsyncResult.isWaiting(get(rendering));
    const last = get(landed);
    const result = last.cleared === get(cleared) ? last.result : null;
    const { produced, producedSource, producedDocument } = last;
    const broken =
      now.hold === "invalid" ||
      (result !== null && result.diagnostics.length > 0);
    const retained =
      broken &&
      produced !== null &&
      producedDocument === now.document &&
      sameSelection(now, produced)
        ? shownRetained(produced, producedSource, now.source)
        : null;
    const identityMismatch =
      result !== null &&
      (result.sourceRevision !== templateSourceRevision(now.source) ||
        !sameSelection(now, result));
    return {
      result: shownResult(result, last.source, now.source),
      retained,
      busy,
      staleReason: staleReasonFor(now, result !== null && !identityMismatch),
      trigger: last.trigger,
      attempt: last.attempt,
    };
  }).pipe(Atom.withEquality(sameState<R>));

  const command = <W>(
    write: (ctx: Atom.WriteContext<void>, value: W) => void,
  ) => Atom.writable<void, W>(() => undefined, write);

  return {
    state,
    run: command((ctx) => {
      const request = nextRequest(ctx.get(input));
      if (request === null) return;
      const at = ctx.get(generation);
      ctx.set(cancelled, at);
      ctx.set(job, { generation: at, request, trigger: "explicit" });
    }),
    pause: command((ctx) => ctx.set(cancelled, ctx.get(generation))),
    invalidate: command((ctx) => ctx.set(epoch, ctx.get(epoch) + 1)),
    fail: command((ctx, diagnostic: RenderDiagnostic) => {
      const now = ctx.get(input);
      ctx.set(cancelled, ctx.get(generation));
      ctx.set(job, null);
      ctx.set(failure, {
        published: failed(failedRender(renderIdentity(now), diagnostic)),
        source: now.source,
        trigger: "automatic",
        now,
        clearedNow: ctx.get(cleared),
      });
    }),
  };
}
