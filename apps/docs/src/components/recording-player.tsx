import {
  bufferFeature,
  Container,
  Controls,
  controlsFeature,
  createPlayer,
  FullscreenButton,
  fullscreenFeature,
  Hotkey,
  I18nProvider,
  PlayButton,
  playbackFeature,
  sourceFeature,
  StatusAnnouncer,
  Time,
  TimeSlider,
  timeFeature,
} from "@videojs/react";
import { Video } from "@videojs/react/video";
import { Maximize, Minimize, Pause, Play, RotateCcw } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { secondaryButtonClass } from "@/components/learn/action-classes.ts";
import {
  askTurn,
  endTurn,
  holdTurn,
  takeTurn,
} from "@/components/recording-turn.ts";
import { cn } from "@/lib/cn.ts";
import * as m from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

const { Player } = createPlayer({
  features: [
    playbackFeature,
    timeFeature,
    sourceFeature,
    bufferFeature,
    fullscreenFeature,
    controlsFeature,
  ],
});

export interface RecordingPlayerProps {
  base: string;
  poster: string;
  alt: string;
  fit: "contain" | "cover";
  preload: "auto" | "metadata";
  loop?: boolean;
  endActions?: ReactNode;
  playNow?: boolean;
}

const videoSrc = (path: string) => __MEDIA_URLS__[path] ?? path;

const buttonClass =
  "group/button grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-fd-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring motion-safe:active:scale-[0.96]";

const iconClass =
  "col-start-1 row-start-1 size-4 motion-safe:transition-opacity motion-safe:duration-150";

export default function RecordingPlayer({
  base,
  poster,
  alt,
  fit,
  preload,
  loop = true,
  endActions,
  playNow = false,
}: RecordingPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [reduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [chosen, setChosen] = useState<"manual" | "paused" | null>(() =>
    playNow && !reduced ? "manual" : null,
  );
  const [ended, setEnded] = useState(false);
  const mode = ended ? "paused" : (chosen ?? (reduced ? "paused" : "auto"));
  const [touched, setTouched] = useState(false);
  const askedPlay = useRef(0);
  const askedPause = useRef(0);
  const owedView = useRef(playNow && !reduced);
  const [me] = useState(() => Symbol(base));

  const rest = useCallback(() => {
    const v = video.current;
    if (!v || v.paused) return;
    askedPause.current += 1;
    v.pause();
  }, []);

  const start = useCallback(async () => {
    const v = video.current;
    if (!v) return false;
    if (!v.paused) return true;
    askedPlay.current += 1;
    try {
      await v.play();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return true;
      askedPlay.current -= 1;
      return false;
    }
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (mode === "paused") {
      const held = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) endTurn(me);
      });
      held.observe(v);
      return () => held.disconnect();
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          rest();
          endTurn(me);
        } else if (mode === "auto" || owedView.current) {
          owedView.current = false;
          askTurn(me, { rest, start });
        }
      },
      mode === "auto" ? { rootMargin: "-40% 0px -40% 0px" } : undefined,
    );
    observer.observe(v);
    return () => observer.disconnect();
  }, [mode, me, rest, start]);

  useEffect(
    () => () => {
      rest();
      endTurn(me);
    },
    [me, rest],
  );

  useEffect(() => {
    if (!playNow || reduced) return;
    takeTurn(me, { rest, start });
  }, [playNow, reduced, me, rest, start]);

  function onPlay() {
    setEnded(false);
    if (askedPlay.current > 0) {
      askedPlay.current -= 1;
      return;
    }
    takeTurn(me, { rest });
    setTouched(true);
    setChosen("manual");
  }

  function onPause() {
    if (askedPause.current > 0) {
      askedPause.current -= 1;
      return;
    }
    if (video.current?.ended) return;
    holdTurn(me);
    setTouched(true);
    setChosen("paused");
  }

  function onEnded() {
    const f = frame.current;
    if (
      f &&
      f !== document.activeElement &&
      f.contains(document.activeElement)
    ) {
      f.focus({ preventScroll: true });
    }
    setEnded(true);
    endTurn(me);
  }

  return (
    <I18nProvider locale={getLocale()}>
      <Player>
        <Container
          ref={frame}
          aria-label={alt}
          className="group/player @container relative size-full bg-fd-card outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-fd-ring"
          style={
            { "--media-accent-color": "var(--color-fd-ring)" } as CSSProperties
          }
        >
          <Video
            ref={video}
            poster={poster}
            muted
            loop={loop}
            playsInline
            preload={reduced ? "metadata" : preload}
            onPlay={onPlay}
            onPause={onPause}
            onEnded={onEnded}
            className={cn(
              "size-full",
              fit === "cover"
                ? "object-cover [:fullscreen_&]:object-contain"
                : "object-contain",
            )}
          >
            <source src={videoSrc(`${base}.mp4`)} type="video/mp4" />
          </Video>
          {ended && (
            <div className="pointer-events-none absolute inset-0 flex flex-wrap content-center items-center justify-center gap-3 bg-black/55 p-4 transition-opacity duration-150 ease-out *:pointer-events-auto *:focus-visible:outline-white! starting:opacity-0">
              {endActions}
              <button
                type="button"
                onClick={() => {
                  frame.current?.focus({ preventScroll: true });
                  void video.current?.play().catch(() => {});
                }}
                className={cn(
                  secondaryButtonClass,
                  "@max-[20rem]:size-11 @max-[20rem]:justify-center @max-[20rem]:px-0",
                )}
              >
                <RotateCcw aria-hidden strokeWidth={2.25} className="size-4" />
                <span className="@max-[20rem]:sr-only">
                  {m.docs_learn_recording_replay()}
                </span>
              </button>
            </div>
          )}
          {!ended && (
            <Controls.Root>
              <Controls.Content className="pointer-events-none absolute inset-x-2.5 bottom-2.5 transition-opacity duration-150 ease-out not-data-visible:not-has-focus-visible:opacity-0">
                <Controls.Group
                  aria-label={m.docs_learn_recording_controls()}
                  className="pointer-events-auto flex items-center gap-1 rounded-full border border-transparent bg-fd-card p-0.5 shadow-ring"
                >
                  <PlayButton className={buttonClass}>
                    <Pause
                      aria-hidden
                      strokeWidth={2.25}
                      className={cn(
                        iconClass,
                        "group-data-paused/button:opacity-0",
                      )}
                    />
                    <Play
                      aria-hidden
                      strokeWidth={2.25}
                      className={cn(
                        iconClass,
                        "opacity-0 group-data-paused/button:opacity-100",
                      )}
                    />
                  </PlayButton>
                  <TimeSlider.Root
                    step={0.5}
                    largeStep={2}
                    className="group/slider relative mx-1.5 flex h-9 min-w-0 flex-1 cursor-pointer touch-none items-center"
                  >
                    <TimeSlider.Track className="relative h-1 w-full overflow-hidden rounded-full bg-fd-muted-foreground/70">
                      <TimeSlider.Buffer className="absolute inset-y-0 left-0 w-(--media-slider-buffer) bg-fd-foreground/10" />
                      <TimeSlider.Fill className="absolute inset-y-0 left-0 w-(--media-slider-fill) bg-(--media-accent-color) group-data-dragging/slider:w-(--media-slider-pointer)" />
                    </TimeSlider.Track>
                    <TimeSlider.Thumb className="absolute left-(--media-slider-fill) size-3.5 -translate-x-1/2 rounded-full border-2 border-fd-card bg-(--media-accent-color) shadow-ring group-data-dragging/slider:left-(--media-slider-pointer) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-ring" />
                  </TimeSlider.Root>
                  <Time.Group className="shrink-0 px-1 font-mono text-[0.6875rem] text-fd-muted-foreground tabular-nums @max-[18rem]:hidden">
                    <Time.Value type="current" />
                    <Time.Separator className="mx-1" />
                    <Time.Value type="duration" />
                  </Time.Group>
                  <FullscreenButton
                    className={cn(buttonClass, "data-hidden:hidden")}
                  >
                    <Maximize
                      aria-hidden
                      strokeWidth={2.25}
                      className={cn(
                        iconClass,
                        "group-data-fullscreen/button:opacity-0",
                      )}
                    />
                    <Minimize
                      aria-hidden
                      strokeWidth={2.25}
                      className={cn(
                        iconClass,
                        "opacity-0 group-data-fullscreen/button:opacity-100",
                      )}
                    />
                  </FullscreenButton>
                </Controls.Group>
              </Controls.Content>
            </Controls.Root>
          )}
          <Hotkey keys="Space" action="togglePaused" />
          <Hotkey keys="ArrowLeft" action="seekStep" value={-1} />
          <Hotkey keys="ArrowRight" action="seekStep" value={1} />
          {touched && <StatusAnnouncer className="sr-only" />}
        </Container>
      </Player>
    </I18nProvider>
  );
}
