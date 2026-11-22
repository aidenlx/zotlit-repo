import { Puzzle } from "lucide-react";

import * as m from "@/paraglide/messages.js";

export interface CompanionNoteProps {
  version: string;
}

export function CompanionNote({ version }: CompanionNoteProps) {
  return (
    <p className="text-[14.5px] text-fd-muted-foreground italic">
      <Puzzle
        aria-hidden
        className="mr-[0.2em] inline size-[1em] shrink-0 align-[-0.14em] text-fd-primary select-none"
      />
      {m.docs_companion_release({ version })}
    </p>
  );
}
