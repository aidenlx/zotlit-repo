import { readFileSync } from "node:fs";

export interface ClipSettings {
  camera: boolean;
  zoom: number;
  hold: number;
  openHold: number;
  lead: number;
  ease: number;
  minEase: number;
  central: number;
  padding: number;
  context: number;
  opening: number;
  rest: number;
  openPad: number;
  endPad: number;
  glide: number;
  typing: number;
  width: number;
  fps: number;
  posterQuality: number;
  h264Crf: number;
}

export const defaultClipSettings: ClipSettings = {
  camera: true,
  zoom: 1.4,
  hold: 2.5,
  openHold: 1.5,
  lead: 0.5,
  ease: 1,
  minEase: 0.6,
  central: 1,
  padding: 32,
  context: 160,
  opening: 1,
  rest: 1.5,
  openPad: 0.8,
  endPad: 1,
  glide: 0.6,
  typing: 1,
  width: 1440,
  fps: 30,
  posterQuality: 82,
  h264Crf: 32,
};

export function clipSettings(base: Partial<ClipSettings> = {}): ClipSettings {
  const file = process.env.DOCS_WALK_CLIP_FILE;
  const inline = process.env.DOCS_WALK_CLIP;
  const settings: ClipSettings = {
    ...defaultClipSettings,
    ...base,
    ...(file &&
      (JSON.parse(readFileSync(file, "utf8")) as Partial<ClipSettings>)),
    ...(inline && (JSON.parse(inline) as Partial<ClipSettings>)),
  };
  for (const key of Object.keys(settings))
    if (!(key in defaultClipSettings))
      throw new Error(`unknown clip setting ${key}`);
  return settings;
}

export const cutKeys = [
  "zoom",
  "hold",
  "openHold",
  "lead",
  "ease",
  "minEase",
  "central",
  "context",
  "padding",
  "openPad",
  "endPad",
] as const satisfies readonly (keyof ClipSettings)[];

export const recordedKeys = Object.keys(defaultClipSettings).filter(
  (key) => !(cutKeys as readonly string[]).includes(key),
);

export function cutSettings(
  settings: Partial<ClipSettings>,
): Partial<ClipSettings> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) =>
      (cutKeys as readonly string[]).includes(key),
    ),
  );
}

export function recutSettings(recorded: Partial<ClipSettings>): ClipSettings {
  return clipSettings(
    Object.fromEntries(
      Object.entries(recorded).filter(([key]) => recordedKeys.includes(key)),
    ),
  );
}
