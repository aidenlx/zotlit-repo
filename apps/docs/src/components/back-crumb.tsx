import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";

export function BackCrumb({
  to,
  label,
}: {
  to: LinkProps["to"];
  label: string;
}) {
  return (
    <p className="mt-11.5">
      <Link
        to={to}
        className="inline-flex items-center gap-1.5 font-mono text-xs font-medium tracking-widest text-fd-muted-foreground uppercase hover:text-fd-primary"
      >
        <span aria-hidden>←</span> {label}
      </Link>
    </p>
  );
}
