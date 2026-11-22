import type { ReactNode } from "react";

import { DocsImage } from "@/components/docs-image.tsx";
import { Recording } from "@/components/recording.tsx";
import { cn } from "@/lib/cn.ts";
import type { StepMedia } from "@/lib/learn-media.ts";

export function stepMedia(media: string, n: number) {
  const key = `${media}/step-${n}`;
  const entry: StepMedia | undefined = __LEARN_MEDIA__[key];
  if (!entry) return undefined;
  const base = `/img/learn/${key}`;
  const still = entry.poster
    ? { src: `${base}.poster.webp`, ...entry.poster }
    : { src: `${base}.webp`, width: entry.width, height: entry.height };
  return { ...entry, base, still };
}

export function StepPicture({
  media,
  n,
  alt,
  active,
  loop = true,
  endActions,
  playNow = false,
  thumb = false,
  priority = false,
}: {
  media: string;
  n: number;
  alt: string;
  active: boolean;
  loop?: boolean;
  endActions?: ReactNode;
  playNow?: boolean;
  thumb?: boolean;
  priority?: boolean;
}) {
  const entry = stepMedia(media, n);
  if (!entry) return null;
  const frame = thumb
    ? { width: 1440, height: 860 }
    : (entry.clip?.size ?? entry.still);
  const still = (
    <DocsImage
      src={entry.still.src}
      width={entry.still.width}
      height={entry.still.height}
      alt={alt}
      loading={thumb ? "lazy" : undefined}
      priority={priority}
      className={thumb ? "max-h-none!" : "max-h-full object-contain"}
    />
  );

  return (
    <div
      className={cn(
        "relative flex justify-center overflow-hidden rounded-[10px] border border-transparent bg-fd-card shadow-ring",
        thumb ? "items-start" : "max-h-[min(70vh,560px)] items-center",
      )}
      style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
    >
      {active && entry.clip && !thumb ? (
        <Recording
          key={entry.base}
          base={entry.base}
          poster={entry.still.src}
          alt={alt}
          fit="contain"
          preload="auto"
          loop={loop}
          endActions={endActions}
          playNow={playNow}
          fallback={still}
        />
      ) : (
        still
      )}
    </div>
  );
}
