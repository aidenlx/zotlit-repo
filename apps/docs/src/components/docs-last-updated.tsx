import { useHydrated } from "@tanstack/react-router";

import { Message } from "@/components/message.tsx";
import { cn } from "@/lib/cn.ts";
import * as m from "@/paraglide/messages.js";

export function DocsLastUpdated({
  date,
  className,
}: {
  date?: Date;
  className?: string;
}) {
  const day = date?.toISOString().slice(0, 10);
  const hydrated = useHydrated();
  const label =
    hydrated && date
      ? date.toLocaleDateString(undefined, { timeZone: "UTC" })
      : day;
  if (!day) return null;
  return (
    <p className={cn("text-sm text-fd-muted-foreground", className)}>
      <Message
        text={m.docs_last_updated({ date: "{date}" })}
        slots={{
          date: (
            <time dateTime={day} className="whitespace-nowrap">
              {label}
            </time>
          ),
        }}
      />
    </p>
  );
}
