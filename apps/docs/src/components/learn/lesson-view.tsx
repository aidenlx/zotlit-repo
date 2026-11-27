import {
  Link,
  useHydrated,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import {
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn.ts";
import type { LessonOpeningView } from "@/lib/lesson-opening.ts";
import * as m from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import { textLinkClass } from "./action-classes.ts";
import { DecisionOpening } from "./decision-opening.tsx";
import {
  bodyClass,
  buttonClass,
  displayClass,
  focusClass,
  focusPart,
  labelClass,
  metaClass,
  TickButton,
  titleClass,
} from "./lesson-mdx.tsx";
import {
  firstOpenStep,
  LessonContext,
  nextOpenStep,
  openOnLoad,
  readProgress,
  saveTicks,
} from "./lesson-state.ts";
import type {
  LessonProgress,
  LessonStepMeta,
  LessonState,
} from "./lesson-state.ts";
import { StepPicture } from "./step-picture.tsx";

export interface ChoreLink {
  slug: string;
  lesson: number;
  title: string;
  chore: string;
  minutes: number;
  media: string;
  result: { n: number; alt: string };
}

export interface LessonViewData {
  slug: string;
  title: string;
  lesson: number;
  minutes: number;
  note?: string;
  media: string;
  instead: string;
  needs: { item: string; detail: string }[];
  steps: LessonStepMeta[];
  end: { title: string; caption: string };
  further: FurtherLink[];
  opening?: LessonOpeningView;
  others: ChoreLink[];
}

export interface FurtherLink {
  title: string;
  href: string;
  when: string;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const wideQuery = "(min-width: 80rem)";

function useWide() {
  return useSyncExternalStore(
    (change) => {
      const query = window.matchMedia(wideQuery);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => window.matchMedia(wideQuery).matches,
    () => false,
  );
}

export function LessonView({
  lesson,
  children,
}: {
  lesson: LessonViewData;
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const wide = useWide();
  const ready = useHydrated();
  const progress = useMemo<Record<string, LessonProgress>>(
    () => (ready ? readProgress() : {}),
    [ready],
  );
  const savedTicks = useMemo<ReadonlySet<number>>(
    () => new Set(progress[lesson.slug]?.ticks),
    [progress, lesson.slug],
  );
  const [tickedTicks, setTicks] = useState<ReadonlySet<number> | null>(null);
  const ticks = tickedTicks ?? savedTicks;
  const [open, setOpen] = useState<number | null>(null);
  const [launched, setLaunched] = useState<number | null>(null);
  const [say, setSay] = useState("");
  const currentTicks = useRef<ReadonlySet<number>>(new Set());
  const written = useRef<string | null>(null);
  const reveal = useRef<number | null>(null);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-lesson-js", "");
  }, []);

  useLayoutEffect(() => {
    currentTicks.current = savedTicks;
    written.current = null;
  }, [savedTicks]);

  useLayoutEffect(() => {
    if (!ready) return;
    if (written.current === hash) return;
    written.current = null;
    setOpen(openOnLoad(hash, [...currentTicks.current], total));
  }, [hash, total, ready, lesson.slug]);

  useEffect(() => {
    const n = reveal.current;
    reveal.current = null;
    if (n === null) return;
    const row = document.getElementById(n > total ? "done" : String(n));
    if (!row) return;
    const top = row.getBoundingClientRect().top;
    const bar = document.querySelector("[data-lesson-bar]");
    const covered = bar?.getBoundingClientRect().bottom ?? 0;
    if (top < covered || top > window.innerHeight * 0.6) {
      row.scrollIntoView({
        block: "start",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [open, total]);

  function show(n: number | null, into: number | null = n) {
    setOpen(n);
    setLaunched(null);
    reveal.current = into;
    const next = n === null ? "" : String(n);
    written.current = next;
    void navigate({
      to: ".",
      hash: next,
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
    });
  }

  function tick(n: number, done: boolean) {
    const next = new Set(ticks);
    if (done) next.add(n);
    else next.delete(n);
    currentTicks.current = next;
    setTicks(next);
    saveTicks(lesson.slug, next, total);
    if (!done) {
      setSay(m.docs_learn_say_unticked({ number: n }));
      show(n);
      return n;
    }
    const after = nextOpenStep(next, n, total);
    if (after === undefined) {
      setSay(m.docs_learn_say_all_done({ total }));
      show(null, total + 1);
      return total + 1;
    }
    setSay(
      m.docs_learn_say_ticked({
        number: n,
        next: after,
        title: lesson.steps[after - 1]?.title ?? "",
      }),
    );
    show(after);
    return after;
  }

  function start() {
    const n = firstOpenStep(ticks, total);
    if (n === undefined) return;
    setSay(
      m.docs_learn_say_opened({
        number: n,
        title: lesson.steps[n - 1]?.title ?? "",
      }),
    );
    show(n);
    setLaunched(n);
    focusPart(n, total);
  }
  const next = ready && open === null ? firstOpenStep(ticks, total) : undefined;
  const startButton = next !== undefined && (
    <button
      type="button"
      onClick={start}
      className={cn(buttonClass, "justify-self-start")}
    >
      {m.docs_learn_start_step({
        number: next,
        begun: ticks.size > 0 ? "yes" : "no",
      })}
      <ArrowRight aria-hidden strokeWidth={2.25} className="size-4" />
    </button>
  );

  const state: LessonState = {
    media: lesson.media,
    steps: lesson.steps,
    live: ready
      ? {
          open,
          ticks,
          tick,
          toggle: (n) => show(open === n ? null : n),
          go: (n) => (n > total ? show(null, n) : show(n)),
          wide,
          launched,
        }
      : null,
  };
  const count = ticks.size;
  const allDone = ready && count >= total;

  return (
    <LessonContext value={state}>
      <script
        dangerouslySetInnerHTML={{
          __html: `document.documentElement.setAttribute("data-lesson-js","")`,
        }}
      />
      <div
        data-lesson=""
        data-ready={ready ? "" : undefined}
        className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-12 px-5 pt-6 pb-24 [html[data-lesson-js]_&]:xl:max-w-[1400px] [html[data-lesson-js]_&]:xl:grid-cols-[minmax(0,580px)_minmax(0,1fr)]"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-8">
          <Opener lesson={lesson} />
          <Outcome lesson={lesson} active={ready && !wide}>
            {startButton}
          </Outcome>
          {lesson.opening && (
            <DecisionOpening opening={lesson.opening} media={lesson.media} />
          )}
          <div>
            <div
              data-lesson-bar=""
              className="sticky top-(--fd-banner-height,0px) z-10 -mx-5 flex items-center gap-3 border-b border-fd-border bg-fd-background px-5 py-3"
            >
              <span aria-hidden className="flex min-w-0 flex-1 gap-1">
                {lesson.steps.map((_, index) => {
                  const n = index + 1;
                  return (
                    <span
                      key={n}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-colors duration-150",
                        ticks.has(n)
                          ? "bg-check-label"
                          : ready && open === n
                            ? "bg-fd-foreground"
                            : "bg-fd-border",
                      )}
                    />
                  );
                })}
              </span>
              <p
                className={cn(
                  metaClass,
                  "shrink-0 tabular-nums",
                  allDone ? "text-check-label" : "text-fd-muted-foreground",
                )}
              >
                <span aria-hidden>
                  {count}/{total}
                </span>
                <span className="sr-only">
                  {m.docs_learn_count_done({ count, total })}
                </span>
              </p>
            </div>
            <p aria-live="polite" className="sr-only">
              {say}
            </p>
            <ol className="mt-2">{children}</ol>
          </div>
          {(!ready || allDone) && <End lesson={lesson} progress={progress} />}
          <GoFurther further={lesson.further} />
        </div>
        {ready && wide && (
          <MediaPanel lesson={lesson}>{startButton}</MediaPanel>
        )}
      </div>
    </LessonContext>
  );
}

function Opener({ lesson }: { lesson: LessonViewData }) {
  return (
    <section aria-labelledby="lesson-title" className="grid gap-4">
      <div className="grid gap-2">
        <p className={cn(metaClass, "text-fd-muted-foreground")}>
          {m.docs_learn_minutes({ minutes: lesson.minutes })}
        </p>
        <h1
          id="lesson-title"
          className={cn(displayClass, "font-serif font-medium")}
        >
          {lesson.title}
        </h1>
      </div>
      <p className={cn(bodyClass, "text-pretty")}>{lesson.instead}</p>
      <div className={cn(metaClass, "grid gap-1")}>
        <p>
          <span className="text-fd-muted-foreground">
            {m.docs_learn_you_need()}{" "}
          </span>
          {lesson.needs.map(({ item, detail }, index) => (
            <span key={item}>
              {index > 0 && (
                <span aria-hidden className="text-fd-muted-foreground">
                  {" · "}
                </span>
              )}
              <span className="font-semibold">{item}</span>{" "}
              <span className="text-fd-muted-foreground">({detail})</span>
            </span>
          ))}
        </p>
        {lesson.note && (
          <p className="text-pretty text-fd-muted-foreground">{lesson.note}</p>
        )}
      </div>
    </section>
  );
}

function Outcome({
  lesson,
  active,
  children,
}: {
  lesson: LessonViewData;
  active: boolean;
  children: ReactNode;
}) {
  const total = lesson.steps.length;
  const last = lesson.steps[total - 1];
  if (!last) return null;

  return (
    <section
      aria-labelledby="lesson-outcome"
      className="grid items-center gap-x-5 gap-y-3 min-[561px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [html[data-lesson-js]_&]:xl:hidden"
    >
      <div className="grid content-center gap-1.5">
        <p className={cn(labelClass, "text-fd-primary")}>
          {m.docs_learn_ends_with()}
        </p>
        <p
          id="lesson-outcome"
          className={cn(titleClass, "font-serif font-medium text-balance")}
        >
          {lesson.end.title}
        </p>
        {children && <div className="mt-2.5">{children}</div>}
      </div>
      <StepPicture
        media={lesson.media}
        n={total}
        alt={last.alt}
        active={active}
        priority
      />
    </section>
  );
}

function MediaPanel({
  lesson,
  children,
}: {
  lesson: LessonViewData;
  children: ReactNode;
}) {
  const live = use(LessonContext)!.live!;
  const { open, ticks, launched } = live;
  const total = lesson.steps.length;
  const step = open === null ? undefined : lesson.steps[open - 1];
  const last = lesson.steps[total - 1];

  return (
    <aside
      aria-label={m.docs_learn_panel_label()}
      className="sticky top-[calc(var(--fd-banner-height,0px)+1.5rem)] grid gap-3 self-start"
    >
      {open !== null && step ? (
        <>
          <p
            className={cn(
              titleClass,
              "flex gap-2.5 font-serif font-medium text-balance",
            )}
          >
            {ticks.has(open) ? (
              <span className="shrink-0 self-center text-check-label">
                <Check aria-hidden strokeWidth={3} className="size-5" />
                <span className="sr-only">{m.docs_learn_progress_done()}</span>
              </span>
            ) : (
              <span
                aria-hidden
                className="shrink-0 font-sans font-normal text-fd-primary tabular-nums"
              >
                {open}
              </span>
            )}
            <span className="min-w-0">{step.title}</span>
          </p>
          <StepPicture
            key="step"
            media={lesson.media}
            n={open}
            alt={step.alt}
            active
            loop={false}
            endActions={<TickButton n={open} total={total} live={live} />}
            playNow={launched === open}
          />
        </>
      ) : (
        last && (
          <>
            <div className="grid gap-1.5">
              <p className={cn(labelClass, "text-fd-primary")}>
                {m.docs_learn_ends_with()}
              </p>
              <p
                className={cn(
                  titleClass,
                  "font-serif font-medium text-balance",
                )}
              >
                {lesson.end.title}
              </p>
            </div>
            <StepPicture
              key="outcome"
              media={lesson.media}
              n={total}
              alt={last.alt}
              active
            />
            {children}
          </>
        )
      )}
    </aside>
  );
}

function nextChores(
  lesson: LessonViewData,
  progress: Record<string, LessonProgress>,
) {
  const isDone = (other: ChoreLink) => progress[other.slug]?.done ?? false;
  const after = [
    ...lesson.others.filter((other) => other.lesson > lesson.lesson),
    ...lesson.others.filter((other) => other.lesson < lesson.lesson),
  ];
  const first = after.find((other) => other.lesson === 1 && !isDone(other));
  const open = after.filter((other) => other !== first && !isDone(other));
  const done = after.filter((other) => other !== first && isDone(other));
  return [...(first ? [first] : []), ...open, ...done].slice(0, 2);
}

function End({
  lesson,
  progress,
}: {
  lesson: LessonViewData;
  progress: Record<string, LessonProgress>;
}) {
  return (
    <section
      id="done"
      tabIndex={-1}
      aria-labelledby="lesson-end-title"
      className="grid scroll-mt-[calc(var(--fd-banner-height,0px)+5rem)] gap-5 rounded-[14px] border border-transparent bg-fd-card p-5 shadow-ring outline-none motion-safe:animate-lesson-in min-[561px]:p-7"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-check-label text-fd-background">
          <Check aria-hidden strokeWidth={3} className="size-5" />
        </span>
        <h2
          id="lesson-end-title"
          className={cn(titleClass, "min-w-0 font-semibold text-balance")}
        >
          {m.docs_learn_complete({ number: lesson.lesson })}
        </h2>
      </div>
      <p className={cn(bodyClass, "text-pretty")}>{lesson.end.caption}</p>
      <div className="grid gap-3">
        <h3 className={cn(metaClass, "font-semibold text-fd-muted-foreground")}>
          {m.docs_learn_more_chores()}
        </h3>
        <ul className="grid gap-3 min-[561px]:grid-cols-2">
          {nextChores(lesson, progress).map((other) => (
            <li key={other.slug}>
              <ChoreCard chore={other} done={progress[other.slug]?.done} />
            </li>
          ))}
        </ul>
        <Link
          to="/learn"
          className={cn(
            metaClass,
            textLinkClass,
            "justify-self-start py-1.5 font-semibold",
            focusClass,
          )}
        >
          {m.docs_learn_all_chores()}
        </Link>
      </div>
    </section>
  );
}

function ChoreCard({ chore, done }: { chore: ChoreLink; done?: boolean }) {
  return (
    <div className="group relative grid h-full content-start gap-2.5 rounded-[12px] border border-transparent bg-fd-background p-3 shadow-ring transition-shadow duration-150 hover:shadow-ring-hover">
      <StepPicture
        media={chore.media}
        n={chore.result.n}
        alt={chore.result.alt}
        active={false}
        thumb
      />
      <p className={cn(titleClass, "font-serif font-medium text-balance")}>
        {m.docs_learn_chore_quote({ chore: chore.chore })}
      </p>
      <h4 className={cn(metaClass, "font-semibold text-pretty")}>
        <Link
          to="/learn/$lesson"
          params={{ lesson: chore.slug }}
          className={cn(
            "rounded-sm after:absolute after:inset-0 after:rounded-[12px] after:content-['']",
            focusClass,
          )}
        >
          {chore.title}
        </Link>
      </h4>
      <p
        className={cn(
          metaClass,
          "flex flex-wrap items-center gap-x-2 text-fd-muted-foreground",
        )}
      >
        {m.docs_learn_minutes({ minutes: chore.minutes })}
        {done && <DoneBadge />}
      </p>
    </div>
  );
}

function GoFurther({ further }: { further: FurtherLink[] }) {
  if (further.length === 0) return null;
  return (
    <nav aria-labelledby="lesson-further" className="grid gap-3">
      <h2
        id="lesson-further"
        className={cn(titleClass, "font-serif font-medium text-balance")}
      >
        {m.docs_learn_go_further()}
      </h2>
      <ul className="grid gap-2.5">
        {further.map(({ title, href, when }) => (
          <li key={href} className={cn(bodyClass, "text-pretty")}>
            <a
              href={localizeHref(href)}
              className={cn(textLinkClass, "font-semibold", focusClass)}
            >
              {title}
            </a>
            <span className="text-fd-muted-foreground">: {when}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DoneBadge() {
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-check-label">
      <Check aria-hidden strokeWidth={3} className="size-3.5" />
      {m.docs_learn_progress_done()}
    </span>
  );
}
