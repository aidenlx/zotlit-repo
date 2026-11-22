import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";

export async function createTemporaryDirectory(
  prefix = "zotlit-language-packs-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function writeCatalog(
  path: string,
  messages: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(
      {
        $schema: "https://inlang.com/schema/inlang-message-format",
        ...messages,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function createFixtureProject(
  messages: Record<string, unknown>,
  { prefix }: { prefix?: string } = {},
): Promise<string> {
  const fixtureRoot = await createTemporaryDirectory(prefix);
  const projectPath = join(fixtureRoot, "project.inlang");
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    join(projectPath, "settings.json"),
    `${JSON.stringify(
      {
        $schema: "https://inlang.com/schema/project-settings",
        baseLocale: "en",
        locales: ["en"],
        "plugin.inlang.messageFormat": {
          pathPattern: "./messages/{locale}.json",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeCatalog(join(fixtureRoot, "messages", "en.json"), messages);
  return projectPath;
}

export async function addLocale(
  projectPath: string,
  locale: string,
  messages: Record<string, unknown>,
): Promise<void> {
  const settingsPath = join(projectPath, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings.locales = [...settings.locales, locale];
  await writeFile(
    settingsPath,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
  await writeCatalog(
    join(dirname(projectPath), "messages", `${locale}.json`),
    messages,
  );
}

export async function addSourcePattern(
  projectPath: string,
  directoryName: string,
  {
    messages,
    locale = "en",
  }: { messages: Record<string, unknown>; locale?: string },
): Promise<string> {
  const settingsPath = join(projectPath, "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  settings["plugin.inlang.messageFormat"].pathPattern = [
    "./messages/{locale}.json",
    `./${directoryName}/{locale}.json`,
  ];
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  const sourcePath = join(
    dirname(projectPath),
    directoryName,
    `${locale}.json`,
  );
  await writeCatalog(sourcePath, messages);
  return sourcePath;
}
