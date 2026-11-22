import type { ClipSettings } from "./clip-settings.ts";

export const pointerLook = {
  arrow:
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="26" viewBox="0 0 22 26" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))"><path d="M2 1.5v20.2l5.3-5.1 3.4 7.8 3.4-1.5-3.3-7.6 7.4-.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  ring: { border: "#7c5cff", fill: "rgba(124,92,255,.18)" },
  ringKeyframes: [
    { opacity: 1, transform: "scale(.5)" },
    { opacity: 0, transform: "scale(1.4)" },
  ],
  ringMs: 450,
  markMs: 150,
};

export function arrowStyle(transitionMs: number): string {
  return `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition:transform ${transitionMs}ms cubic-bezier(.4,0,.2,1);`;
}

export function ringStyle(
  colors: { border: string; fill: string } = pointerLook.ring,
): string {
  return `width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid ${colors.border};background:${colors.fill};z-index:2147483646;pointer-events:none;`;
}

export function pointerGlide(settings: ClipSettings): {
  transitionMs: number;
  glideMs: number;
} {
  const glideMs = settings.glide * 1000;
  return { transitionMs: Math.max(0, glideMs - 50), glideMs };
}
