import { regex } from "arkregex";
import { execFile } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { mkdtempDisposable, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

import { PLATFORM_MODULES } from "./runtime-table.ts";

type Capability = "dom" | "obsidian" | "node" | "electron";

const CAPABILITY_NAMES: Record<Capability, string> = {
  dom: "the DOM",
  obsidian: "the obsidian module",
  node: "Node",
  electron: "Electron",
};

const ES_LIB = [
  "es2025",
  "esnext.error",
  "esnext.array",
  "esnext.disposable",
  "esnext.temporal",
  "esnext.date",
  "esnext.intl",
  "esnext.collection",
];

interface Zone {
  readonly title: string;
  readonly runsIn: string;
  readonly capabilities: readonly Capability[];
  readonly lib: readonly string[];
  readonly typeCheck: boolean;
}

const ZONES = {
  worker: {
    title: "Worker",
    runsIn: "a Web Worker on each host",
    capabilities: [],
    lib: [...ES_LIB, "webworker"],
    typeCheck: true,
  },
  "host-free": {
    title: "host-free",
    runsIn: "a renderer on each host",
    capabilities: ["dom"],
    lib: [...ES_LIB, "dom"],
    typeCheck: false,
  },
  obsidian: {
    title: "Obsidian",
    runsIn: "Obsidian on Mobile and desktop",
    capabilities: ["dom", "obsidian"],
    lib: [...ES_LIB, "dom"],
    typeCheck: false,
  },
  desktop: {
    title: "desktop",
    runsIn: "desktop Obsidian",
    capabilities: ["dom", "obsidian", "node", "electron"],
    lib: [...ES_LIB, "dom"],
    typeCheck: false,
  },
} as const satisfies Record<string, Zone>;

export type ZoneName = keyof typeof ZONES;

type FileZone = ZoneName | "test-support";

const LAYER_FOLDERS: Record<string, ZoneName> = {
  worker: "worker",
  core: "host-free",
  obsidian: "obsidian",
  desktop: "desktop",
};

export interface Violation {
  readonly file: string;
  readonly rule: string;
  readonly chain: readonly string[];
}

export interface ZoneReport {
  readonly zone: ZoneName;
  readonly files: number;
  readonly violations: readonly Violation[];
}

const TEST_SUPPORT =
  /\.(?:test|browser-test|bench)\.tsx?$|(?:^|\/)(?:__fixtures__(?:\/|\.tsx?$)|__mocks__\/)/;
const DIAGNOSTIC = regex(
  "^(?<file>.+)\\((?<line>\\d+),(?<column>\\d+)\\): error (?<code>TS\\d+): (?<message>.*)$",
);
const EDGE = regex(
  "^\\s+(?:Imported|Referenced|Type library referenced) via (?:\"[^\"]*\"|'[^']*') from file '(?<from>[^']+)'",
);
const QUOTED = regex("'(?<name>[^']+)'");
const MODULE_NOT_FOUND = new Set(["TS2307", "TS2792", "TS2882", "TS7016"]);
const AUGMENTATION_NOT_FOUND = "TS2664";

interface Workspace {
  readonly packages: readonly {
    dir: string;
    zone: FileZone | undefined;
    layers: Readonly<Record<string, FileZone>>;
  }[];
}

function readWorkspace(workspaceRoot: string): Workspace {
  const manifest = parse(
    readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8"),
  ) as { packages?: string[] };
  const packages = (manifest.packages ?? [])
    .flatMap((pattern) =>
      globSync(`${pattern}/package.json`, { cwd: workspaceRoot }),
    )
    .map((file) => {
      const pkg = JSON.parse(
        readFileSync(join(workspaceRoot, file), "utf8"),
      ) as {
        zotlit?: { layer?: FileZone; layers?: Record<string, FileZone> };
      };
      return {
        dir: dirname(resolve(workspaceRoot, file)),
        zone: pkg.zotlit?.layer,
        layers: { ...LAYER_FOLDERS, ...pkg.zotlit?.layers },
      };
    })
    .toSorted((a, b) => b.dir.length - a.dir.length);
  return { packages };
}

function zoneOf(
  workspace: Workspace,
  file: string,
): FileZone | "none" | undefined {
  if (file.includes(`${sep}node_modules${sep}`)) return undefined;
  const pkg = workspace.packages.find(({ dir }) => file.startsWith(dir + sep));
  if (!pkg) return undefined;
  const path = relative(pkg.dir, file).split(sep);
  if (TEST_SUPPORT.test(path.join("/"))) return "test-support";
  const [top, folder, ...rest] = path;
  if (top === "src" && folder && rest.length > 0 && pkg.layers[folder])
    return pkg.layers[folder];
  return pkg.zone ?? "none";
}

function platformModule(file: string): string | undefined {
  const parts = file.split(sep);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return undefined;
  const first = parts[at + 1] ?? "";
  const name = first.startsWith("@") ? `${first}/${parts[at + 2]}` : first;
  return name in PLATFORM_MODULES ? name : undefined;
}

function platformSpecifier(specifier: string): string | undefined {
  return Object.keys(PLATFORM_MODULES).find(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

function zoneFiles(workspace: Workspace, zone: ZoneName): string[] {
  return workspace.packages
    .flatMap((pkg) =>
      globSync("src/**/*.{ts,tsx}", { cwd: pkg.dir }).map((file) =>
        join(pkg.dir, file),
      ),
    )
    .filter((file) => zoneOf(workspace, file) === zone)
    .toSorted();
}

function missing(zone: ZoneName, needs: readonly Capability[]): Capability[] {
  const has: readonly Capability[] = ZONES[zone].capabilities;
  return needs.filter((capability) => !has.includes(capability));
}

function absentRule(zone: ZoneName, absent: readonly Capability[]): string {
  const { title, runsIn } = ZONES[zone];
  const names = absent.map((capability) => CAPABILITY_NAMES[capability]);
  const article = /^[aeiou]/i.test(title) ? "An" : "A";
  return `${article} ${title} file loads in ${runsIn}, where ${names.join(" and ")} ${names.length > 1 ? "are" : "is"} absent`;
}

const tsc = join(
  dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
  "bin/tsc",
);

function explainProgram(
  workspaceRoot: string,
  project: string,
): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      [tsc, "-p", project, "--explainFiles", "--pretty", "false"],
      { cwd: workspaceRoot, maxBuffer: 1 << 30 },
      (error, stdout, stderr) => {
        if (error && !stdout) fail(new Error(stderr || error.message));
        else done(stdout);
      },
    );
  });
}

interface Program {
  readonly importers: Map<string, Set<string>>;
  readonly diagnostics: {
    file: string;
    line: string;
    code: string;
    message: string;
  }[];
}

function readProgram(workspaceRoot: string, output: string): Program {
  const importers = new Map<string, Set<string>>();
  const diagnostics: Program["diagnostics"] = [];
  let current: string | undefined;
  for (const line of output.split("\n")) {
    const diagnostic = DIAGNOSTIC.exec(line);
    if (diagnostic) {
      const { file, line: at, code, message } = diagnostic.groups;
      diagnostics.push({
        file: resolve(workspaceRoot, file),
        line: at,
        code,
        message,
      });
      current = undefined;
    } else if (line && !/^\s/.test(line)) {
      current = resolve(workspaceRoot, line.trim());
      if (!importers.has(current)) importers.set(current, new Set());
    } else if (current) {
      const edge = EDGE.exec(line);
      if (edge)
        importers.get(current)?.add(resolve(workspaceRoot, edge.groups.from));
    }
  }
  return { importers, diagnostics };
}

interface Closure {
  readonly workspace: Workspace;
  readonly roots: readonly string[];
  readonly followsTestSupport: boolean;
}

export function checkZone(
  workspaceRoot: string,
  zone: ZoneName,
): Promise<ZoneReport> {
  const workspace = readWorkspace(workspaceRoot);
  return checkClosure(workspaceRoot, zone, {
    workspace,
    roots: zoneFiles(workspace, zone),
    followsTestSupport: false,
  });
}

export function checkRoot(
  workspaceRoot: string,
  zone: ZoneName,
  files: readonly string[],
): Promise<ZoneReport> {
  return checkClosure(workspaceRoot, zone, {
    workspace: readWorkspace(workspaceRoot),
    roots: files.map((file) => resolve(workspaceRoot, file)),
    followsTestSupport: true,
  });
}

async function checkClosure(
  workspaceRoot: string,
  zone: ZoneName,
  { workspace, roots, followsTestSupport }: Closure,
): Promise<ZoneReport> {
  if (roots.length === 0) return { zone, files: 0, violations: [] };

  await using dir = await mkdtempDisposable(join(tmpdir(), "zt-runtime-zone-"));
  const project = join(dir.path, "tsconfig.json");
  await writeFile(
    project,
    JSON.stringify({
      compilerOptions: {
        target: "es2025",
        lib: ZONES[zone].lib,
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        types: [],
      },
      files: roots,
    }),
  );
  const program = readProgram(
    workspaceRoot,
    await explainProgram(workspaceRoot, project),
  );

  const imports = new Map<string, Set<string>>();
  for (const [file, from] of program.importers)
    for (const importer of from) {
      if (!imports.has(importer)) imports.set(importer, new Set());
      imports.get(importer)?.add(file);
    }

  const platformRule = (name: string): string | undefined => {
    const absent = missing(zone, [PLATFORM_MODULES[name]!]);
    return absent.length > 0 ? `${absentRule(zone, absent)}.` : undefined;
  };

  const targets = new Map<string, { label: string; rule: string }>();
  for (const file of program.importers.keys()) {
    const name = platformModule(file);
    if (name) {
      const rule = platformRule(name);
      if (rule) targets.set(file, { label: name, rule });
      continue;
    }
    const target = zoneOf(workspace, file);
    if (!target) continue;
    if (target === "none") {
      targets.set(file, {
        label: relative(workspaceRoot, file),
        rule: `${relative(workspaceRoot, file)} has no zone, so the check cannot tell where it loads. State the zone of its package or folder.`,
      });
      continue;
    }
    if (target === "test-support") {
      if (followsTestSupport) continue;
      targets.set(file, {
        label: relative(workspaceRoot, file),
        rule: `Plugin code loads no test support; ${relative(workspaceRoot, file)} is test support.`,
      });
      continue;
    }
    const absent = missing(zone, ZONES[target].capabilities);
    if (absent.length > 0)
      targets.set(file, {
        label: relative(workspaceRoot, file),
        rule: `${absentRule(zone, absent)}; ${relative(workspaceRoot, file)} is in the ${ZONES[target].title} zone.`,
      });
  }

  const parent = new Map<string, string | undefined>();
  const queue = roots.filter((file) => program.importers.has(file));
  for (const file of queue) parent.set(file, undefined);
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    if (targets.has(file)) continue;
    for (const next of [...(imports.get(file) ?? [])].toSorted()) {
      if (parent.has(next)) continue;
      parent.set(next, file);
      queue.push(next);
    }
  }
  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let at: string | undefined = file; at; at = parent.get(at))
      chain.unshift(targets.get(at)?.label ?? relative(workspaceRoot, at));
    return chain;
  };

  const violations: Violation[] = [];
  const report = (chain: readonly string[], rule: string) =>
    violations.push({ file: chain[0]!, rule, chain });

  for (const file of queue) {
    const target = targets.get(file);
    if (target) report(chainTo(file), target.rule);
  }

  const { title, typeCheck } = ZONES[zone];
  for (const { file, line, code, message } of program.diagnostics) {
    if (!parent.has(file) || targets.has(file)) continue;
    const at = `${relative(workspaceRoot, file)}:${line}`;
    const name = QUOTED.exec(message)?.groups.name ?? "";
    const platform = platformSpecifier(name);
    const augmentation = code === AUGMENTATION_NOT_FOUND;
    if (platform && (augmentation || MODULE_NOT_FOUND.has(code))) {
      const rule = platformRule(platform);
      if (rule) report([...chainTo(file), name], rule);
    } else if (augmentation) {
      report(
        chainTo(file),
        `A module augmentation names "${name}", which the ${title} zone program does not load, so the check cannot follow it (${at}).`,
      );
    } else if (typeCheck) {
      report(
        chainTo(file),
        `${absentRule(zone, ["dom"])}: ${at} ${code} ${message}`,
      );
    }
  }

  return { zone, files: roots.length, violations };
}
