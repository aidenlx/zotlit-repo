import type { CliCommand, CliHost } from "#cli-command.ts";

export function fakeCliHost() {
  const commands = new Map<string, CliCommand>();
  const host: CliHost = {
    registerCliCommand: (name, command) => {
      commands.set(name, command);
    },
  };
  const command = (name: string): CliCommand => {
    const registered = commands.get(name);
    if (!registered) throw new Error(`${name} is not registered`);
    return registered;
  };
  return { host, commands, command };
}
