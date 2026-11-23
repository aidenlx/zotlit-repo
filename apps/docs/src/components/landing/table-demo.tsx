import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { askTurn, endTurn, takeTurn } from "@/components/recording-turn.ts";
import { m } from "@/paraglide/messages.js";

import { demoMotion } from "./demo-motion.ts";
import { LessonLink, LoopToggle } from "./parts.tsx";
import { DemoWindow, FINAL, Trail, makeFlip } from "./table-window.tsx";

const TIMELINE: readonly (readonly [number, number])[] = [
  [2000, 1],
  [2650, 2],
  [3900, 3],
  [4250, 4],
  [5900, 5],
  [6450, 6],
  [7050, 7],
  [7650, 8],
  [8250, 9],
  [9700, 10],
  [10200, 11],
  [12000, 12],
  [12650, 13],
  [13200, 14],
  [13750, 15],
  [14300, 16],
  [14950, FINAL],
];
const END = 19800;

function Demo() {
  const [step, setStep] = useState(FINAL);
  const [cycle, setCycle] = useState(0);
  const [fading, setFading] = useState(false);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const figure = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const visibleRatio = useRef<number | null>(null);
  const reduced = useRef(false);
  const eligible = useRef(false);
  const [flip] = useState(makeFlip);
  const [me] = useState(() => Symbol("table demo"));

  const rest = () => {
    flip.stop(stage.current);
    setActive(false);
    setStep(FINAL);
    setFading(false);
  };
  const showCollection = () => {
    setStep(0);
    setFading(false);
  };
  const start = () => {
    showCollection();
    setCycle((c) => c + 1);
    setActive(true);
    return true;
  };
  const updateEligibility = (readerPaused: boolean, byReader = false) => {
    const next = demoMotion({
      wasEligible: eligible.current,
      visibleRatio: visibleRatio.current,
      reduced: reduced.current,
      paused: readerPaused,
      byReader,
    });
    eligible.current = next.eligible;
    if (next.turn === "end") endTurn(me);
    if (next.turn === "end" || next.frame === "finished") rest();
    if (next.frame === "collection") showCollection();
    if (next.turn === "ask") askTurn(me, { rest, start });
    if (next.turn === "take") takeTurn(me, { rest, start });
  };
  const toggle = () => {
    setPaused(!paused);
    updateEligibility(!paused, true);
  };

  const onView = useEffectEvent((entry: IntersectionObserverEntry) => {
    visibleRatio.current = entry.intersectionRatio;
    updateEligibility(paused);
  });
  const onMotion = useEffectEvent((matches: boolean) => {
    reduced.current = matches;
    updateEligibility(paused);
  });

  useEffect(() => {
    const el = figure.current;
    if (!el) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => onMotion(event.matches);
    onMotion(preference.matches);
    preference.addEventListener("change", onChange);
    const io = new IntersectionObserver(([entry]) => entry && onView(entry), {
      threshold: [0, 0.5],
    });
    io.observe(el);
    return () => {
      io.disconnect();
      preference.removeEventListener("change", onChange);
      visibleRatio.current = null;
      eligible.current = false;
      endTurn(me);
    };
  }, [me]);

  useLayoutEffect(() => {
    flip.play(stage.current);
  }, [flip, step]);

  useEffect(() => {
    if (!active) return;
    const ids = TIMELINE.map(([t, s]) =>
      window.setTimeout(() => {
        flip.snap(stage.current);
        setStep(s);
      }, t),
    );
    ids.push(window.setTimeout(() => setFading(true), END - 650));
    ids.push(
      window.setTimeout(() => {
        setStep(0);
        setFading(false);
        setCycle((c) => c + 1);
      }, END),
    );
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [flip, active, cycle]);

  return (
    <figure ref={figure} className="relative">
      <div aria-hidden>
        <DemoWindow step={step} fading={fading} stageRef={stage} />
      </div>
      <figcaption className="sr-only">{m.docs_home_table_alt()}</figcaption>
      <div className="mt-4 flex items-start gap-4">
        <Trail
          step={step}
          cycle={cycle}
          playing={active}
          className="min-w-0 flex-1"
        />
        <LoopToggle
          paused={paused}
          onToggle={toggle}
          pauseLabel={m.docs_home_table_pause()}
          playLabel={m.docs_home_table_play()}
          className="shrink-0"
        />
      </div>
    </figure>
  );
}

const POINTS = [
  [m.docs_home_table_point_zotero, m.docs_home_table_point_zotero_line],
  [m.docs_home_table_point_yours, m.docs_home_table_point_yours_line],
  [m.docs_home_table_point_unread, m.docs_home_table_point_unread_line],
] as const;

export function TableDemo() {
  return (
    <section
      aria-labelledby="landing-table-title"
      className="border-t border-fd-border py-20 sm:py-28"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <div className="max-w-2xl">
          <h2
            id="landing-table-title"
            className="font-serif text-3xl leading-[1.2] font-medium text-balance sm:text-5xl sm:leading-[1.15] zh:leading-[1.3] zh:tracking-normal zh:wrap-anywhere zh:break-keep"
          >
            {m.docs_home_table_title()}
          </h2>
          <p className="mt-6 text-lg text-pretty text-fd-muted-foreground">
            {m.docs_home_table_lede()}
          </p>
          <div className="mt-4">
            <LessonLink
              lesson="literature-review-table-from-zotero"
              label={m.docs_home_table_link()}
            />
          </div>
        </div>
        <div className="mt-10 sm:mt-12">
          <Demo />
        </div>
        <ul className="mt-8 grid gap-x-10 gap-y-4 text-base sm:grid-cols-3">
          {POINTS.map(([lead, line]) => (
            <li
              key={lead()}
              className="border-t border-fd-border pt-4 text-pretty"
            >
              <strong className="font-semibold text-fd-foreground">
                {lead()}
              </strong>{" "}
              <span className="text-fd-muted-foreground">{line()}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
