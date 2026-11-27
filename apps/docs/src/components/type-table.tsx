import { useHydrated } from "@tanstack/react-router";
import Link from "fumadocs-core/link";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "fumadocs-ui/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Fragment, useMemo, useState } from "react";

import { cn } from "@/lib/cn.ts";
import * as m from "@/paraglide/messages.js";

export interface DetailNode {
  label: string;
  content: ReactNode;
}

export interface TypeNode {
  description?: ReactNode;
  type: ReactNode;
  typeDescription?: ReactNode;
  typeDescriptionLink?: string;
  required?: boolean;
  details?: readonly DetailNode[];
}

const fieldClassName = "text-fd-muted-foreground not-prose pe-2";

export function TypeTable({
  anchor,
  type,
  prefix,
  className,
  ...props
}: {
  type: Record<string, TypeNode>;
  anchor?: string;
  prefix?: string;
} & ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "@container my-6 flex flex-col overflow-hidden rounded-2xl border bg-fd-card p-1 text-sm text-fd-card-foreground",
        className,
      )}
      {...props}
    >
      <div className="not-prose flex items-center px-3 py-1 font-medium text-fd-muted-foreground">
        <p className="w-1/4">{m.docs_table_prop()}</p>
        <p className="@max-xl:hidden">{m.docs_table_type()}</p>
      </div>
      {Object.entries(type).map(([key, value]) => (
        <Item
          key={key}
          anchor={anchor}
          name={key}
          prefix={prefix}
          item={value}
        />
      ))}
    </div>
  );
}

function Item({
  anchor,
  name,
  prefix,
  item: {
    description,
    required = false,
    typeDescription,
    type,
    typeDescriptionLink,
    details = [],
  },
}: {
  anchor?: string;
  name: string;
  prefix?: string;
  item: TypeNode;
}) {
  const id = anchor ? `${anchor}-${name}` : undefined;
  const hydrated = useHydrated();
  const linked = useMemo(
    () => hydrated && !!id && window.location.hash === `#${id}`,
    [hydrated, id],
  );
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? linked;

  return (
    <Collapsible
      id={id}
      open={open}
      onOpenChange={(v) => {
        if (v && id) {
          window.history.replaceState(null, "", `#${id}`);
        }
        setOpen(v);
      }}
      className={cn(
        "scroll-m-20 overflow-hidden rounded-xl border transition-all",
        open
          ? "bg-fd-background shadow-sm not-last:mb-2"
          : "border-transparent",
      )}
    >
      <CollapsibleTrigger className="not-prose group relative flex w-full flex-row items-center px-3 py-2 text-start hover:bg-fd-accent">
        <code className="w-1/4 min-w-fit pe-2 font-mono font-medium text-fd-primary">
          {prefix}
          {name}
          {!required && "?"}
        </code>
        {typeDescriptionLink ? (
          <Link href={typeDescriptionLink} className="underline @max-xl:hidden">
            {type}
          </Link>
        ) : (
          <span className="@max-xl:hidden">{type}</span>
        )}
        <ChevronDown className="absolute inset-e-2 size-4 text-fd-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="fd-scroll-container grid grid-cols-[1fr_3fr] gap-y-4 overflow-auto border-t p-3 text-sm">
          <div className="col-span-full prose prose-no-margin text-sm empty:hidden">
            {description}
          </div>
          {typeDescription && (
            <>
              <p className={fieldClassName}>{m.docs_table_type()}</p>
              <p className="not-prose my-auto">{typeDescription}</p>
            </>
          )}
          {details.map((detail) => (
            <Fragment key={detail.label}>
              <p className={fieldClassName}>{detail.label}</p>
              <div className="not-prose my-auto">{detail.content}</div>
            </Fragment>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
