import { asMarkdown, md } from "fumadocs-core/server";
import { Terminal } from "lucide-react";

import { toast } from "@/components/ui/toast.tsx";
import * as m from "@/paraglide/messages.js";
import type { LocalizedString } from "@/paraglide/runtime.js";

interface CommandOptions {
  inline?: boolean;
}

export type CommandProps = CommandOptions &
  (
    | {
        name: LocalizedString;
        children?: never;
      }
    | {
        children: string;
        name?: never;
      }
  );

export function Command(props: CommandProps) {
  const inline = props.inline ?? false;
  const commandName =
    props.name === undefined ? props.children : `ZotLit: ${props.name}`;

  if (asMarkdown()) {
    return inline
      ? md`\`${commandName}\``
      : md.linePrefix("> ")`${m.docs_command_label()}: \`${commandName}\``;
  }

  if (inline) {
    return (
      <span className="not-prose inline">
        <Terminal
          aria-hidden
          className="mr-[0.2em] inline size-[1em] shrink-0 align-[-0.14em] text-fd-primary select-none"
        />
        <span className="border-b border-fd-primary/45 pb-[0.02em] font-medium text-fd-foreground">
          {commandName}
        </span>
      </span>
    );
  }
  return <BlockCommand commandName={commandName} />;
}

function BlockCommand({ commandName }: { commandName: string }) {
  function copy() {
    navigator.clipboard.writeText(commandName).then(
      () => {
        toast.add({ title: m.docs_command_copied_label(), type: "success" });
      },
      () => {},
    );
  }

  return (
    <span className="not-prose my-4 flex items-center gap-2 border-b border-fd-border pt-1 pb-2">
      <Terminal
        aria-hidden
        className="size-[1.15rem] shrink-0 text-fd-primary select-none"
      />
      <span className="font-serif text-[1.22rem] leading-tight font-medium text-fd-foreground">
        {commandName}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={m.docs_command_copy_label()}
        className={
          "ml-auto shrink-0 cursor-pointer self-center font-mono text-[0.68rem] font-semibold tracking-widest text-fd-primary uppercase transition-opacity" +
          " hover:opacity-80" +
          " focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
        }
      >
        {m.docs_command_copy()}
      </button>
    </span>
  );
}
