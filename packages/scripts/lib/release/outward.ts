import { $ } from "zx";

export type Command = readonly [string, ...string[]];

export interface OutwardStep {
  command: Command;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  standIn?: () => Promise<void>;
  run?: () => Promise<void>;
}

export interface Outward {
  readonly dryRun: boolean;
  run(step: OutwardStep): Promise<void>;
  readonly commands: readonly string[];
}

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
