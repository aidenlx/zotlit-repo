import { regex } from "arkregex";

export const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

const CONVENTIONAL_SUBJECT = regex(
  "^(?<type>[a-z]+)(?:\\((?<scope>[^()\\s]+)\\))?!?: (?<description>\\S.*)$",
);

export const CONVENTIONAL_FORMAT = `<type>(<scope>): <description>, with the type one of ${CONVENTIONAL_TYPES.join(", ")}; the scope and a "!" before the colon are optional`;

export function isConventionalSubject(message: string): boolean {
  const subject = message.split("\n", 1)[0]!.trim();
  const type = CONVENTIONAL_SUBJECT.exec(subject)?.groups.type;
  return (
    type !== undefined &&
    (CONVENTIONAL_TYPES as readonly string[]).includes(type)
  );
}
