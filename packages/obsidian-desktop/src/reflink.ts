import { Schema } from "effect";
import { execFile } from "node:child_process";
import { constants, copyFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class ReflinkUnsupportedError extends Schema.TaggedError<
  ReflinkUnsupportedError,
  { readonly brand: unique symbol }
>()("ReflinkUnsupportedError", {
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return "Native reflink is unsupported";
  }
}

export async function reflink(
  sourcePath: string,
  newTargetPath: string,
): Promise<void> {
  if (process.platform === "darwin") {
    await reflinkMac(sourcePath, newTargetPath);
    return;
  }
  if (process.platform === "linux") {
    await copyFile(
      sourcePath,
      newTargetPath,
      constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL,
    );
    return;
  }
  throw new ReflinkUnsupportedError();
}

async function reflinkMac(
  sourcePath: string,
  newTargetPath: string,
): Promise<void> {
  try {
    await execFileAsync("cp", ["-c", "-n", sourcePath, newTargetPath]);
  } catch (error) {
    if (isClonefileUnsupported(error))
      throw new ReflinkUnsupportedError({ cause: error });
    throw error;
  }
}

export function isClonefileUnsupported(error: unknown): boolean {
  const stderr: unknown = (error as { stderr?: unknown } | null | undefined)
    ?.stderr;
  return typeof stderr === "string" && stderr.includes("clonefile failed");
}
