import { Effect } from "effect";
import type { IconName } from "obsidian";
import { getIcon } from "obsidian";
import type { CSSProperties, ReactNode, SVGAttributes } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { cn } from "#utils.ts";

export interface IconProps extends Omit<
  SVGAttributes<SVGSVGElement>,
  "children"
> {
  name: IconName;
  size?: IconSize | number | (string & Record<never, never>);
  strokeWidth?: number | string;
}

export type IconSize = "xs" | "s" | "m" | "l";

const ICON_SIZES: ReadonlySet<string> = new Set<IconSize>([
  "xs",
  "s",
  "m",
  "l",
]);

export function Icon({
  name,
  size,
  strokeWidth,
  className,
  style,
  ...rest
}: IconProps) {
  const ref = useRef<SVGSVGElement>(null);
  const ownedAttrs = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;

    for (const attr of ownedAttrs.current) svg.removeAttribute(attr);
    ownedAttrs.current.clear();

    const proto = getIcon(name);
    if (!proto) {
      svg.replaceChildren();
      Effect.runSyncWith(logServices)(
        Effect.logWarning("Unknown icon {name}").pipe(
          Effect.annotateLogs({ name }),
          withLogCategory("ui.icon"),
        ),
      );
      return;
    }

    svg.replaceChildren(...proto.childNodes);

    for (const attr of proto.attributes) {
      if (attr.name === "class") continue;
      svg.setAttribute(attr.name, attr.value);
      ownedAttrs.current.add(attr.name);
    }
  }, [name]);

  const iconClass = useMemo(
    () => getIcon(name)?.getAttribute("class") ?? "svg-icon",
    [name],
  );

  const cssVars: CSSProperties & Record<`--${string}`, string | number> = {};
  if (typeof size === "string" && ICON_SIZES.has(size)) {
    cssVars["--icon-size"] = `var(--icon-${size})`;
    cssVars["--icon-stroke"] = `var(--icon-${size}-stroke-width)`;
  } else if (size !== undefined) {
    cssVars["--icon-size"] = typeof size === "number" ? `${size}px` : size;
  }
  if (strokeWidth !== undefined) {
    cssVars["--icon-stroke"] = strokeWidth;
  }

  const decorative =
    rest["aria-label"] === undefined && rest["aria-labelledby"] === undefined;

  return (
    <svg
      ref={ref}
      {...(decorative ? { "aria-hidden": true } : { role: "img" })}
      {...rest}
      className={cn(iconClass, className)}
      style={{ ...cssVars, ...style }}
    />
  );
}

export function FirstLine({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "zt:flex zt:h-[1lh] zt:shrink-0 zt:items-center",
        className,
      )}
    >
      {children}
    </span>
  );
}
