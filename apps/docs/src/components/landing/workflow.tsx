import { useEffect, useRef, useState } from "react";

import { DocsImage } from "@/components/docs-image.tsx";
import { Recording as RecordingPlayer } from "@/components/recording.tsx";
import { m } from "@/paraglide/messages.js";

import { LessonLink } from "./parts.tsx";

type Text = () => string;

type Case = "find" | "read" | "note" | "cite" | "word";

const CLIPS: Readonly<Record<Case, boolean>> = {
  find: true,
  read: true,
  note: true,
  cite: true,
  word: false,
};

interface Step {
  id: Case;
  title: Text;
  line: Text;
  points: readonly (readonly [lead: Text, line: Text])[];
  note?: Text;
  alt: Text;
  lesson: string;
  link: Text;
}

const STEPS: readonly Step[] = [
  {
    id: "find",
    title: m.docs_home_flow_find,
    line: m.docs_home_flow_find_line,
    points: [
      [m.docs_home_flow_find_point1, m.docs_home_flow_find_point1_line],
      [m.docs_home_flow_find_point2, m.docs_home_flow_find_point2_line],
    ],
    alt: m.docs_home_flow_find_alt,
    lesson: "connect-zotero-to-obsidian",
    link: m.docs_home_flow_find_link,
  },
  {
    id: "read",
    title: m.docs_home_flow_read,
    line: m.docs_home_flow_read_line,
    points: [
      [m.docs_home_flow_read_point1, m.docs_home_flow_read_point1_line],
      [m.docs_home_flow_read_point2, m.docs_home_flow_read_point2_line],
    ],
    alt: m.docs_home_flow_read_alt,
    lesson: "annotate-zotero-pdfs-in-obsidian",
    link: m.docs_home_flow_read_link,
  },
  {
    id: "note",
    title: m.docs_home_flow_note,
    line: m.docs_home_flow_note_line,
    points: [
      [m.docs_home_flow_note_point1, m.docs_home_flow_note_point1_line],
      [m.docs_home_flow_note_point2, m.docs_home_flow_note_point2_line],
    ],
    alt: m.docs_home_flow_note_alt,
    lesson: "connect-zotero-to-obsidian",
    link: m.docs_home_flow_note_link,
  },
  {
    id: "cite",
    title: m.docs_home_flow_cite,
    line: m.docs_home_flow_cite_line,
    points: [
      [m.docs_home_flow_cite_point1, m.docs_home_flow_cite_point1_line],
      [m.docs_home_flow_cite_point2, m.docs_home_flow_cite_point2_line],
    ],
    note: m.docs_home_flow_cite_note,
    alt: m.docs_home_flow_cite_alt,
    lesson: "cite-in-obsidian-with-zotero",
    link: m.docs_home_flow_cite_link,
  },
  {
    id: "word",
    title: m.docs_home_flow_word,
    line: m.docs_home_flow_word_line,
    points: [
      [m.docs_home_flow_word_point1, m.docs_home_flow_word_point1_line],
      [m.docs_home_flow_word_point2, m.docs_home_flow_word_point2_line],
    ],
    alt: m.docs_home_flow_word_alt,
    lesson: "export-obsidian-to-word-with-citations",
    link: m.docs_home_flow_word_link,
  },
];

function Recording({ id, alt }: { id: Case; alt: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const base = `/img/landing/${id}`;

  useEffect(() => {
    const el = frame.current;
    if (!el || !CLIPS[id]) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [id]);

  const still = (
    <DocsImage
      src={`${base}.webp`}
      width={1600}
      height={1000}
      alt={alt}
      loading="lazy"
      className="size-full object-cover"
    />
  );
  return (
    <div
      ref={frame}
      className="relative aspect-[16/10] overflow-hidden rounded-xl border border-transparent bg-fd-card shadow-ring"
    >
      {near ? (
        <RecordingPlayer
          base={base}
          poster={`${base}.webp`}
          alt={alt}
          fit="cover"
          preload="metadata"
          fallback={still}
        />
      ) : (
        still
      )}
    </div>
  );
}

function StepItem({ step, n, flip }: { step: Step; n: number; flip: boolean }) {
  return (
    <li className="relative grid items-center gap-8 lg:grid-cols-2 lg:gap-24">
      <span
        aria-hidden
        className="absolute top-1/2 left-1/2 hidden size-9 -translate-1/2 items-center justify-center rounded-full border border-fd-border bg-fd-background font-mono text-sm text-fd-primary tabular-nums lg:flex"
      >
        {n}
      </span>
      <div className={flip ? "lg:order-2" : undefined}>
        <Recording id={step.id} alt={step.alt()} />
      </div>
      <div
        className={
          flip ? "max-w-xl lg:order-1 lg:justify-self-end" : "max-w-xl"
        }
      >
        <h3 className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-4xl zh:leading-[1.3] zh:tracking-normal zh:wrap-anywhere zh:break-keep">
          {step.title()}
        </h3>
        <p className="mt-4 text-lg text-pretty text-fd-muted-foreground">
          {step.line()}
        </p>
        <ul className="mt-6 grid gap-4">
          {step.points.map(([lead, line]) => (
            <li
              key={lead()}
              className="border-t border-fd-border pt-4 text-base text-pretty"
            >
              <strong className="font-semibold text-fd-foreground">
                {lead()}
              </strong>{" "}
              <span className="text-fd-muted-foreground">{line()}</span>
            </li>
          ))}
        </ul>
        {step.note && (
          <p className="mt-4 rounded-[10px] bg-fd-muted px-4 py-3 text-base text-fd-muted-foreground">
            {step.note()}
          </p>
        )}
        <div className="mt-6">
          <LessonLink lesson={step.lesson} label={step.link()} />
        </div>
      </div>
    </li>
  );
}

export function Workflow() {
  return (
    <section
      aria-labelledby="landing-flow-title"
      className="border-t border-fd-border bg-fd-card/40 py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="landing-flow-title"
            className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-5xl sm:leading-[1.15] zh:leading-[1.3] zh:tracking-normal zh:wrap-anywhere zh:break-keep"
          >
            {m.docs_home_flow_title()}
          </h2>
          <p className="mt-6 text-lg text-pretty text-fd-muted-foreground">
            {m.docs_home_flow_lede()}
          </p>
        </div>
        <div className="relative mt-16 sm:mt-20">
          <span
            aria-hidden
            className="absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-fd-border lg:block"
          />
          <ol className="relative grid gap-20 lg:gap-32">
            {STEPS.map((s, i) => (
              <StepItem key={s.id} step={s} n={i + 1} flip={i % 2 === 1} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
