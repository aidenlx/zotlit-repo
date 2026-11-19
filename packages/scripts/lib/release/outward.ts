// The steps of a release that reach outside this machine, as the commands a
// real run executes. A real run executes each one; a dry run prints it and
// runs a local stand-in. Both build the command from the same function, so
// the dry run prints what the real run does.
import { $ } from "zx";

export type Command = readonly [string, ...string[]];

export interface OutwardStep {
  /** The command a real run executes. */
  command: Command;
  cwd?: string;
  /** Extra environment of the command; a dry run prints only the names. */
  env?: Readonly<Record<string, string>>;
  /** What a dry run does in its place; nothing when absent. */
  standIn?: () => Promise<void>;
  /** In a real run, run this in place of `command`, such as a library call. */
  run?: () => Promise<void>;
}

export interface Outward {
  readonly dryRun: boolean;
  run(step: OutwardStep): Promise<void>;
  /** The commands of each outward step, in order, as a person types them. */
  readonly commands: readonly string[];
}

/** One command as a shell line; arguments with spaces are quoted. */
export function formatCommand(step: OutwardStep): string {
  const env = Object.keys(step.env ?? {}).map((name) => `${name}=…`);
  const words = [...env, ...step.command].map((word) =>
    /^[\w@%+=:,./…-]+$/.test(word)
      ? word
      : `'${word.replaceAll("'", "'\\''")}'`,
  );
  return `${step.cwd ? `(cd ${step.cwd} && ` : ""}${words.join(" ")}${step.cwd ? ")" : ""}`;
}

export function makeOutward(options: {
  dryRun: boolean;
  say: (line: string) => void;
}): Outward {
  const commands: string[] = [];
  return {
    dryRun: options.dryRun,
    commands,
    async run(step) {
      const line = formatCommand(step);
      commands.push(line);
      if (options.dryRun) {
        options.say(`dry run, not run: ${line}`);
        await step.standIn?.();
        return;
      }
      options.say(`$ ${line}`);
      if (step.run) {
        await step.run();
        return;
      }
      const [command, ...args] = step.command;
      await $({
        stdio: "inherit",
        ...(step.cwd ? { cwd: step.cwd } : {}),
        env: { ...process.env, ...step.env },
      })`${command} ${args}`;
    },
  };
}
