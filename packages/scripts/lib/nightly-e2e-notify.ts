import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo, Server as TcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

export const NIGHTLY_E2E_NOTIFY_WORKFLOW =
  ".github/workflows/nightly-e2e-notify.yml";

const NOTIFY_NAME = "Notify Grok Bot of Nightly End-to-end Run";
const WORKFLOW_NAME = "Nightly End-to-end Run";
const WORKFLOW_ID = 426681463;
const WORKFLOW_PATH = ".github/workflows/nightly-e2e.yml";
const REPOSITORY = "aidenlx/zotlit-repo";
const POSTED = "Posted the Nightly End-to-end Run event.";

const WEBHOOK_ENV = {
  WEBHOOK_URL: "${{ secrets.GROK_BOT_WEBHOOK_URL }}",
  WEBHOOK_KEY: "${{ secrets.GROK_BOT_WEBHOOK_KEY }}",
} as const;

const REQUIRED_SNIPPETS = [
  "set -euo pipefail\n",
  "node and curl must be on PATH.",
  "GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY must both be set.",
  "The GitHub event file is missing or empty.",
  "umask 077\n",
  "mktemp -d",
  "trap 'rm -rf \"$workdir\"' EXIT",
  'NOTIFY_WORKDIR="$workdir" node "$workdir/check-event.cjs"',
  'curl -q --config "$workdir/curl.cfg"',
  '--header @"$workdir/authorization"',
  '2>"$workdir/curl.err"',
  "-u http_proxy",
  "-u https_proxy",
  "-u all_proxy",
  "-u HTTP_PROXY",
  "-u HTTPS_PROXY",
  "-u ALL_PROXY",
  "-u no_proxy",
  "-u NO_PROXY",
  'noproxy = "*"',
  'proto = "=https"',
  "disallow-username-in-url",
  "connect-timeout = 10",
  "max-time = 30",
  'header = "Content-Type: application/json"',
  'header = "Expect:"',
  "data-binary = ",
  "GITHUB_EVENT_PATH",
  "Authorization: Bearer ",
  WORKFLOW_NAME,
  String(WORKFLOW_ID),
  WORKFLOW_PATH,
  REPOSITORY,
  'head_branch !== "main"',
  'event.action !== "completed"',
  'run.status !== "completed"',
  "The webhook returned HTTP ",
  "The webhook request failed before a response",
  POSTED,
];

const FORBIDDEN_SNIPPETS = [
  "set -x",
  "bash -x",
  "--verbose",
  "--trace",
  "--location",
  "--insecure",
  "--proxy",
  "github.event",
  "github.token",
  "GH_TOKEN",
  "secrets.",
  "toJSON",
  "console.log",
  "actions/checkout",
  "download-artifact",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  '"success"',
  '"failure"',
  '"cancelled"',
  '"timed_out"',
  "workflow_dispatch",
  "schedule",
  " -k ",
  " -L ",
];

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface Hit {
  method: string;
  url: string;
  authorization: string;
  contentType: string;
  expect: string;
  contentLength: string;
  transferEncoding: string;
  body: Buffer;
}

interface Scenario {
  name: string;
  eventText?: string;
  omitEvent?: boolean;
  url?: string;
  omitUrl?: boolean;
  key?: string;
  omitKey?: boolean;
  status?: number;
  responseBody?: string;
  location?: string;
  proxy?: boolean;
  curlrc?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  hits: number;
}

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

function sameKeys(value: unknown, expected: readonly string[]): boolean {
  const keys = keysOf(value).sort();
  const want = [...expected].sort();
  return (
    keys.length === want.length &&
    keys.every((key, index) => key === want[index])
  );
}

function sameList(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function emptyPermissions(value: unknown): boolean {
  return sameKeys(value, []);
}

function usesAction(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => usesAction(item));
  const record = value as Record<string, unknown>;
  if ("uses" in record) return true;
  return Object.values(record).some((item) => usesAction(item));
}

function hardcodedUrl(text: string): boolean {
  for (const marker of ["https://", "http://"]) {
    let at = 0;
    while (at < text.length) {
      const found = text.indexOf(marker, at);
      if (found < 0) break;
      const after = text[found + marker.length] ?? "";
      const prefixCheck =
        marker === "https://" && (after === '"' || after === "'");
      if (!prefixCheck) return true;
      at = found + marker.length;
    }
  }
  return false;
}

function webhookEnv(value: unknown): boolean {
  if (!sameKeys(value, ["WEBHOOK_URL", "WEBHOOK_KEY"])) return false;
  const env = value as Record<string, unknown>;
  return (
    env.WEBHOOK_URL === WEBHOOK_ENV.WEBHOOK_URL &&
    env.WEBHOOK_KEY === WEBHOOK_ENV.WEBHOOK_KEY
  );
}

function quotedList(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

export function nightlyE2eNotifyProblems(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "";
    return [`the workflow must be valid YAML${message ? ` (${message})` : ""}`];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return ["the workflow must be a mapping"];
  }
  const workflow = parsed as Record<string, unknown>;
  const problems: string[] = [];
  if (!sameKeys(workflow, ["jobs", "name", "on", "permissions"])) {
    problems.push(
      "the workflow must set only its name, workflow_run trigger, empty permissions, and jobs",
    );
  }
  if (workflow.name !== NOTIFY_NAME) {
    problems.push(`the workflow name must be "${NOTIFY_NAME}"`);
  }
  if (!emptyPermissions(workflow.permissions)) {
    problems.push("the workflow permissions must be {}");
  }
  const trigger = workflow.on;
  if (!sameKeys(trigger, ["workflow_run"])) {
    problems.push("the workflow must trigger only on workflow_run");
  } else {
    const workflowRun = (trigger as Record<string, unknown>).workflow_run;
    if (!sameKeys(workflowRun, ["branches", "types", "workflows"])) {
      problems.push(
        "workflow_run must filter only by workflows, types, and branches",
      );
    } else {
      const fields = workflowRun as Record<string, unknown>;
      if (!sameList(fields.workflows, [WORKFLOW_NAME])) {
        problems.push(`workflow_run must listen only to "${WORKFLOW_NAME}"`);
      }
      if (!sameList(fields.types, ["completed"])) {
        problems.push("workflow_run must listen only to the completed type");
      }
      if (!sameList(fields.branches, ["main"])) {
        problems.push("workflow_run must listen only to main");
      }
    }
  }
  const jobs = workflow.jobs;
  if (!sameKeys(jobs, ["notify"])) {
    problems.push('the workflow must have one job, "notify"');
  } else {
    const job = (jobs as Record<string, unknown>).notify;
    if (
      !sameKeys(job, ["permissions", "runs-on", "steps", "timeout-minutes"])
    ) {
      problems.push(
        "the notify job must set only runs-on, timeout-minutes, empty permissions, and steps",
      );
    }
    if (job && typeof job === "object" && !Array.isArray(job)) {
      const fields = job as Record<string, unknown>;
      if (fields["runs-on"] !== "ubuntu-latest") {
        problems.push("the notify job must run on ubuntu-latest");
      }
      if (fields["timeout-minutes"] !== 2) {
        problems.push("the notify job must time out after 2 minutes");
      }
      if (!emptyPermissions(fields.permissions)) {
        problems.push("the notify job permissions must be {}");
      }
      const steps = fields.steps;
      if (!Array.isArray(steps) || steps.length !== 1) {
        problems.push("the notify job must have one step");
      } else {
        const step = steps[0] as unknown;
        if (!sameKeys(step, ["env", "name", "run"])) {
          problems.push(
            "the post step must set only its name, the webhook env, and its run script",
          );
        }
        if (!webhookEnv((step as { env?: unknown }).env)) {
          problems.push(
            "the post step must read only GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY from the environment",
          );
        }
        const script = (step as { run?: unknown }).run;
        if (typeof script !== "string" || !script.startsWith("set +x\n")) {
          problems.push(
            "the post step must turn off trace before it reads the secrets",
          );
        } else {
          const missing = REQUIRED_SNIPPETS.filter(
            (snippet) => !script.includes(snippet),
          );
          if (missing.length > 0) {
            problems.push(`the post step must include ${quotedList(missing)}`);
          }
          const present = FORBIDDEN_SNIPPETS.filter((snippet) =>
            script.includes(snippet),
          );
          if (present.length > 0) {
            problems.push(
              `the post step must not include ${quotedList(present)}`,
            );
          }
          if (
            script
              .split("\n")
              .some((line) => line.trimStart().startsWith("proxy"))
          ) {
            problems.push("the post step must not set a proxy");
          }
        }
      }
    }
  }
  if (usesAction(workflow)) {
    problems.push(
      "the workflow must not run an action or check out a repository",
    );
  }
  if (text.includes("actions/checkout") || text.includes("download-artifact")) {
    problems.push(
      "the workflow must not check out a repository or download artifacts",
    );
  }
  if (hardcodedUrl(text)) {
    problems.push("the workflow must not hardcode a webhook URL");
  }
  const secretLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("secrets."))
    .sort();
  const allowedSecrets = [
    `WEBHOOK_URL: ${WEBHOOK_ENV.WEBHOOK_URL}`,
    `WEBHOOK_KEY: ${WEBHOOK_ENV.WEBHOOK_KEY}`,
  ].sort();
  if (secretLines.join("\n") !== allowedSecrets.join("\n")) {
    problems.push(
      "the workflow must reference only the GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY secrets",
    );
  }
  return problems;
}

function run(input: {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeout?: number;
}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      input.file,
      input.args,
      {
        cwd: input.cwd,
        env: input.env,
        timeout: input.timeout ?? 10_000,
        encoding: "utf8",
        maxBuffer: 1_048_576,
      },
      (error, stdout, stderr) => {
        if (error?.killed) {
          reject(new Error(`${input.file} timed out`));
          return;
        }
        const code = error && "code" in error ? error.code : 0;
        resolve({
          exitCode: typeof code === "number" ? code : error ? 1 : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function oneHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(",");
  return value ?? "";
}

function reveal(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (shown, secret) =>
      secret ? shown.split(secret).join("[redacted]") : shown,
    text,
  );
}

function eventObject(input: {
  action?: string;
  status?: string;
  conclusion?: string | null;
  eventName?: string;
  branch?: string;
  name?: string;
  id?: number | string;
  repository?: string;
  headRepository?: string;
  path?: string;
}): Record<string, unknown> {
  return {
    action: input.action ?? "completed",
    workflow: {
      id: input.id ?? WORKFLOW_ID,
      name: input.name ?? WORKFLOW_NAME,
      path: input.path ?? WORKFLOW_PATH,
    },
    workflow_run: {
      name: input.name ?? WORKFLOW_NAME,
      head_branch: input.branch ?? "main",
      path: input.path ?? WORKFLOW_PATH,
      workflow_id: input.id ?? WORKFLOW_ID,
      event: input.eventName ?? "schedule",
      status: input.status ?? "completed",
      conclusion: input.conclusion === undefined ? "success" : input.conclusion,
      head_repository: {
        full_name: input.headRepository ?? REPOSITORY,
      },
    },
    repository: { full_name: input.repository ?? REPOSITORY },
  };
}

function scenarios(port: number, key: string): Scenario[] {
  const raw = `{
  "action": "completed",
  "sentinel": "keep  spaces",
  "workflow": {"id":426681463,"name":"Nightly End-to-end Run","path":".github/workflows/nightly-e2e.yml"},
  "workflow_run": {
    "name": "Nightly End-to-end Run",
    "head_branch": "main",
    "path": ".github/workflows/nightly-e2e.yml",
    "workflow_id": 426681463,
    "event": "schedule",
    "status": "completed",
    "conclusion": "success",
    "head_repository": {"full_name":"aidenlx/zotlit-repo"},
    "filler": "${"x".repeat(8000)}"
  },
  "repository": {"full_name":"aidenlx/zotlit-repo"}
}
`;
  const posted = `${POSTED}\n`;
  const httpError = (status: number) =>
    `The webhook returned HTTP ${status}.\n`;
  return [
    {
      name: "a scheduled success",
      eventText: raw,
      exitCode: 0,
      stdout: posted,
      stderr: "",
      hits: 1,
    },
    {
      name: "a manual failure",
      eventText: `${JSON.stringify(eventObject({ conclusion: "failure", eventName: "workflow_dispatch" }))}\n`,
      exitCode: 0,
      stdout: posted,
      stderr: "",
      hits: 1,
    },
    {
      name: "a cancellation",
      eventText: `${JSON.stringify(eventObject({ conclusion: "cancelled" }))}\n`,
      exitCode: 0,
      stdout: posted,
      stderr: "",
      hits: 1,
    },
    {
      name: "an HTTP 401",
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      status: 401,
      responseBody: `Missing Authorization header\n${key}`,
      exitCode: 1,
      stdout: "",
      stderr: httpError(401),
      hits: 1,
    },
    {
      name: "a redirect",
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      status: 302,
      location: `https://127.0.0.1:${port}/steal`,
      exitCode: 1,
      stdout: "",
      stderr: httpError(302),
      hits: 1,
    },
    {
      name: "a missing URL",
      omitUrl: true,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr:
        "GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY must both be set.\n",
      hits: 0,
    },
    {
      name: "a missing key",
      omitKey: true,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr:
        "GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY must both be set.\n",
      hits: 0,
    },
    {
      name: "an http URL",
      url: `http://127.0.0.1:${port}/hook`,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "GROK_BOT_WEBHOOK_URL must be an https URL.\n",
      hits: 0,
    },
    {
      name: "a URL with a query",
      url: `https://127.0.0.1:${port}/hook?key=1`,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr:
        "GROK_BOT_WEBHOOK_URL must be a plain https URL with no query, fragment, or userinfo.\n",
      hits: 0,
    },
    {
      name: "a URL with userinfo",
      url: `https://user:pass@127.0.0.1:${port}/hook`,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr:
        "GROK_BOT_WEBHOOK_URL must be a plain https URL with no query, fragment, or userinfo.\n",
      hits: 0,
    },
    {
      name: "a URL that contains the key",
      key: "secret-token-value",
      url: `https://127.0.0.1:${port}/hook/secret-token-value`,
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "GROK_BOT_WEBHOOK_URL must not contain the webhook key.\n",
      hits: 0,
    },
    {
      name: "a key with a newline",
      key: "good\nbad",
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "GROK_BOT_WEBHOOK_KEY must be a single line.\n",
      hits: 0,
    },
    {
      name: "the wrong repository",
      eventText: `${JSON.stringify(eventObject({ repository: "other/zotlit-repo" }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event repository must be aidenlx/zotlit-repo.\n",
      hits: 0,
    },
    {
      name: "a fork head repository",
      eventText: `${JSON.stringify(eventObject({ headRepository: "fork/zotlit-repo" }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event repository must be aidenlx/zotlit-repo.\n",
      hits: 0,
    },
    {
      name: "a branch other than main",
      eventText: `${JSON.stringify(eventObject({ branch: "develop" }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event head branch must be main.\n",
      hits: 0,
    },
    {
      name: "the wrong workflow",
      eventText: `${JSON.stringify(eventObject({ name: "Record PR" }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event must be the Nightly End-to-end Run workflow.\n",
      hits: 0,
    },
    {
      name: "a string workflow id",
      eventText: `${JSON.stringify(eventObject({ id: "426681463" }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event workflow id must be the Nightly End-to-end Run.\n",
      hits: 0,
    },
    {
      name: "a run that is not completed",
      eventText: `${JSON.stringify(eventObject({ action: "requested", status: "queued", conclusion: null }))}\n`,
      exitCode: 1,
      stdout: "",
      stderr: "The event action must be completed.\n",
      hits: 0,
    },
    {
      name: "a missing event file",
      omitEvent: true,
      exitCode: 1,
      stdout: "",
      stderr: "The GitHub event file is missing or empty.\n",
      hits: 0,
    },
    {
      name: "an event that is not JSON",
      eventText: "{",
      exitCode: 1,
      stdout: "",
      stderr: "The GitHub event file is not JSON.\n",
      hits: 0,
    },
    {
      name: "proxy environment variables",
      eventText: `${JSON.stringify(eventObject({ conclusion: "timed_out" }))}\n`,
      proxy: true,
      exitCode: 0,
      stdout: posted,
      stderr: "",
      hits: 1,
    },
    {
      name: "a curlrc that adds another URL",
      eventText: `${JSON.stringify(eventObject({}))}\n`,
      curlrc: `url = "https://127.0.0.1:${port}/steal"\nverbose\n`,
      exitCode: 0,
      stdout: posted,
      stderr: "",
      hits: 1,
    },
  ];
}

function scriptOf(text: string): string {
  const workflow = parse(text) as {
    jobs?: { notify?: { steps?: { run?: string }[] } };
  };
  const script = workflow.jobs?.notify?.steps?.[0]?.run;
  if (typeof script !== "string") {
    throw new Error("the notify step has no run script");
  }
  return script;
}

async function transportProblems(script: string): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), "nightly-e2e-notify-"));
  try {
    const cert = join(root, "cert.pem");
    const keyPath = join(root, "key.pem");
    const baseEnv = {
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C",
      LC_ALL: "C",
    };
    const generated = await run({
      file: "openssl",
      args: [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-keyout",
        keyPath,
        "-out",
        cert,
        "-days",
        "1",
        "-nodes",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      env: baseEnv,
      cwd: root,
      timeout: 20_000,
    });
    if (generated.exitCode !== 0) {
      return [
        `the local webhook check could not create a certificate (openssl exit ${generated.exitCode})`,
      ];
    }
    const hits: Hit[] = [];
    const connections = { n: 0 };
    const next = { status: 204, body: "", location: "" };
    const server = createServer(
      { cert: readFileSync(cert), key: readFileSync(keyPath) },
      (request, response) => {
        const chunks: Buffer[] = [];
        request.on("error", () => undefined);
        response.on("error", () => undefined);
        request.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        request.on("end", () => {
          hits.push({
            method: request.method ?? "",
            url: request.url ?? "",
            authorization: oneHeader(request.headers.authorization),
            contentType: oneHeader(request.headers["content-type"]),
            expect: oneHeader(request.headers.expect),
            contentLength: oneHeader(request.headers["content-length"]),
            transferEncoding: oneHeader(request.headers["transfer-encoding"]),
            body: Buffer.concat(chunks),
          });
          const headers: Record<string, string> = {};
          if (next.location) headers.Location = next.location;
          response.writeHead(next.status, headers);
          response.end(next.body);
        });
      },
    );
    server.on("connection", () => {
      connections.n += 1;
    });
    const proxyHits = { n: 0 };
    const proxy: TcpServer = createTcpServer((socket) => {
      proxyHits.n += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve) => {
      proxy.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    const proxyPort = (proxy.address() as AddressInfo).port;
    const problems: string[] = [];
    try {
      const scriptPath = join(root, "notify.sh");
      await writeFile(scriptPath, script, { mode: 0o700 });
      const key = 'loc"al+/=key';
      const planned = scenarios(port, key);
      for (let index = 0; index < planned.length; index += 1) {
        const scenario = planned[index];
        if (!scenario) continue;
        hits.length = 0;
        connections.n = 0;
        proxyHits.n = 0;
        next.status = scenario.status ?? 204;
        next.body = scenario.responseBody ?? "";
        next.location = scenario.location ?? "";
        const home = join(root, `home-${index}`);
        await mkdir(home, { recursive: true });
        if (scenario.curlrc) {
          await writeFile(join(home, ".curlrc"), scenario.curlrc, {
            mode: 0o600,
          });
        }
        const eventPath = join(root, "event.json");
        if (!scenario.omitEvent) {
          await writeFile(eventPath, scenario.eventText ?? "", { mode: 0o600 });
        }
        const scenarioKey = scenario.key ?? key;
        const env: NodeJS.ProcessEnv = {
          ...baseEnv,
          HOME: home,
          CURL_HOME: home,
          SSL_CERT_FILE: cert,
          CURL_CA_BUNDLE: cert,
        };
        if (!scenario.omitUrl)
          env.WEBHOOK_URL = scenario.url ?? `https://127.0.0.1:${port}/hook`;
        if (!scenario.omitKey) env.WEBHOOK_KEY = scenarioKey;
        if (!scenario.omitEvent) env.GITHUB_EVENT_PATH = eventPath;
        if (scenario.proxy) {
          const proxyUrl = `http://127.0.0.1:${proxyPort}`;
          env.http_proxy = proxyUrl;
          env.https_proxy = proxyUrl;
          env.HTTP_PROXY = proxyUrl;
          env.HTTPS_PROXY = proxyUrl;
          env.ALL_PROXY = proxyUrl;
          env.all_proxy = proxyUrl;
        }
        const result = await run({
          file: "bash",
          args: ["-eo", "pipefail", scriptPath],
          env,
          cwd: root,
        });
        const secrets = [scenarioKey, key];
        const fail = (detail: string) => {
          problems.push(`${scenario.name}: ${reveal(detail, secrets)}`);
        };
        if (result.exitCode !== scenario.exitCode) {
          fail(
            `exit ${result.exitCode}, expected ${scenario.exitCode}; stdout ${JSON.stringify(result.stdout)}; stderr ${JSON.stringify(result.stderr)}`,
          );
        }
        if (result.stdout !== scenario.stdout) {
          fail(
            `stdout ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(scenario.stdout)}`,
          );
        }
        if (result.stderr !== scenario.stderr) {
          fail(
            `stderr ${JSON.stringify(result.stderr)}, expected ${JSON.stringify(scenario.stderr)}`,
          );
        }
        if (hits.length !== scenario.hits) {
          fail(`received ${hits.length} requests, expected ${scenario.hits}`);
        }
        if (scenario.hits === 0 && connections.n !== 0) {
          fail(`opened ${connections.n} connections`);
        }
        if (proxyHits.n !== 0) {
          fail(`used a proxy ${proxyHits.n} times`);
        }
        const eventBytes = Buffer.from(scenario.eventText ?? "");
        for (const hit of hits) {
          if (hit.method !== "POST" || hit.url !== "/hook") {
            fail(`sent ${hit.method} ${hit.url}`);
          }
          if (hit.authorization !== `Bearer ${scenarioKey}`) {
            fail("sent a different Authorization header");
          }
          if (hit.contentType !== "application/json") {
            fail(`sent Content-Type ${JSON.stringify(hit.contentType)}`);
          }
          if (hit.expect.toLowerCase().includes("100-continue")) {
            fail("sent Expect: 100-continue");
          }
          if (hit.transferEncoding) {
            fail(
              `sent Transfer-Encoding ${JSON.stringify(hit.transferEncoding)}`,
            );
          }
          if (hit.contentLength !== String(hit.body.length)) {
            fail(
              `sent Content-Length ${JSON.stringify(hit.contentLength)} for ${hit.body.length} bytes`,
            );
          }
          if (!hit.body.equals(eventBytes)) {
            fail("sent a body that differs from the event file");
          }
        }
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        proxy.close(() => resolve());
      });
    }
    return problems;
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    return [`the local webhook check could not run (${message})`];
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function nightlyE2eNotifyReport(text: string): Promise<string[]> {
  const problems = nightlyE2eNotifyProblems(text);
  if (problems.length > 0) return problems;
  return transportProblems(scriptOf(text));
}
