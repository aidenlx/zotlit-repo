/** @jsxImportSource preact */
import type { ReaderHost } from "#/core/host.ts";
import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

import { useChrome } from "#/core/chrome/model.ts";

export function Icon(props: { readonly name: string }): JSX.Element {
  return <HostIcon host={useChrome().host} name={props.name} />;
}

export function HostIcon(props: {
  readonly host: ReaderHost;
  readonly name: string;
}): JSX.Element {
  const { host, name } = props;
  const element = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    target.replaceChildren();
    host.icon(target, name);
  }, [host, name]);
  return (
    <span
      ref={element}
      aria-hidden="true"
      className="zpr:inline-flex zpr:items-center zpr:justify-center"
    />
  );
}

export function IconButton(props: {
  readonly icon: string;
  readonly label: string;
  readonly part?: string;
  readonly active?: boolean;
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly menu?: boolean;
  readonly disabled?: boolean;
  readonly onClick: (event: MouseEvent) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-zpr-control=""
      data-zpr-part={props.part}
      data-active={props.active || props.expanded ? "" : undefined}
      aria-label={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      aria-expanded={props.expanded}
      aria-controls={props.controls}
      aria-haspopup={props.menu ? "menu" : undefined}
      disabled={props.disabled}
      onClick={(event) => props.onClick(event)}
      className="zpr:inline-flex zpr:shrink-0 zpr:items-center zpr:justify-center zpr:gap-0.5 zpr:rounded-icon zpr:p-1 zpr:text-icon zpr:cursor-(--cursor,default) zpr:hover:bg-hover zpr:hover:text-icon-hover zpr:disabled:opacity-40 zpr:disabled:hover:bg-transparent zpr:data-active:text-accent zpr:focus-visible:outline-2 zpr:focus-visible:outline-accent"
    >
      <Icon name={props.icon} />
    </button>
  );
}

export function Divider(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="zpr:mx-0.5 zpr:h-4 zpr:w-px zpr:shrink-0 zpr:bg-border"
    />
  );
}
