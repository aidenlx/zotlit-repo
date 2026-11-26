import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NIGHTLY_E2E_NOTIFY_WORKFLOW,
  nightlyE2eNotifyProblems,
  scriptOf,
} from "./nightly-e2e-notify.ts";
import { getWorkspaceRoot } from "./package-roots.ts";

const root = await getWorkspaceRoot(import.meta.dirname);
const workflow = readFileSync(join(root, NIGHTLY_E2E_NOTIFY_WORKFLOW), "utf8");

function once(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  if (at < 0 || text.indexOf(from, at + from.length) !== -1) {
    throw new Error(`expected one ${JSON.stringify(from)}`);
  }
  return `${text.slice(0, at)}${to}${text.slice(at + from.length)}`;
}

function run(input: {
  file: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      input.file,
      input.args,
      {
        cwd: input.cwd,
        env: input.env,
        encoding: "utf8",
        timeout: 15_000,
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

describe("nightlyE2eNotifyProblems", () => {
  it("accepts the notification workflow", () => {
    expect(nightlyE2eNotifyProblems(workflow)).toEqual([]);
  });

  it("reports a trigger that is not the completed Nightly End-to-end Run on main", () => {
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          'workflows: ["Nightly End-to-end Run"]',
          'workflows: ["Record PR"]',
        ),
      ),
    ).toEqual([expect.stringContaining("Nightly End-to-end Run")]);
    expect(
      nightlyE2eNotifyProblems(
        once(workflow, "types: [completed]", "types: [completed, requested]"),
      ),
    ).toEqual([expect.stringContaining("only to the completed type")]);
    expect(
      nightlyE2eNotifyProblems(
        once(workflow, "branches: [main]", "branches: [main, develop]"),
      ),
    ).toEqual([expect.stringContaining("only to main")]);
  });

  it("reports permissions, checkout, and a success filter", () => {
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "branches: [main]\n\npermissions: {}",
          "branches: [main]\n\npermissions:\n  contents: read",
        ),
      ),
    ).toEqual([expect.stringContaining("permissions must be {}")]);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "    steps:\n      - name:",
          "    steps:\n      - uses: actions/checkout@v7\n      - name:",
        ),
      ).some((problem) => problem.includes("must not run an action")),
    ).toBe(true);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "    permissions: {}\n    steps:",
          "    permissions: {}\n    if: github.event.workflow_run.conclusion == 'success'\n    steps:",
        ),
      ),
    ).toEqual([
      expect.stringContaining(
        "must set only runs-on, timeout-minutes, empty permissions, and steps",
      ),
    ]);
  });

  it("reports a post step that drops bearer transport", () => {
    expect(
      nightlyE2eNotifyProblems(once(workflow, "curl -q \\", "curl \\")),
    ).toEqual([expect.stringContaining("curl -q")]);
  });
});

describe("nightly e2e notify transport", () => {
  it("posts the event bytes with bearer auth and fails on HTTP 401", async () => {
    await using stack = new AsyncDisposableStack();
    const work = await mkdtemp(join(tmpdir(), "nightly-e2e-notify-"));
    stack.defer(async () => {
      await rm(work, { recursive: true, force: true });
    });

    const cert = join(work, "cert.pem");
    const key = join(work, "key.pem");
    const openssl = await run({
      file: "openssl",
      args: [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
      ],
      env: process.env,
      cwd: work,
    });
    expect(openssl.exitCode).toBe(0);

    const hits: { authorization: string; body: string }[] = [];
    const server = createServer(
      {
        cert: readFileSync(cert),
        key: readFileSync(key),
      },
      (request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          hits.push({
            authorization: String(request.headers.authorization ?? ""),
            body: Buffer.concat(chunks).toString("utf8"),
          });
          const status = hits.length === 1 ? 204 : 401;
          response.writeHead(status);
          response.end();
        });
      },
    );
    stack.adopt(server, (value) => {
      value.closeAllConnections();
      return new Promise<void>((resolve) => {
        value.close(() => resolve());
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    const url = `https://localhost:${port}/hook`;
    const eventPath = join(work, "event.json");
    const eventBody = JSON.stringify({
      action: "completed",
      workflow_run: { conclusion: "failure", name: "Nightly End-to-end Run" },
    });
    await writeFile(eventPath, eventBody);
    const scriptPath = join(work, "notify.sh");
    await writeFile(scriptPath, scriptOf(workflow));

    const ok = await run({
      file: "bash",
      args: [scriptPath],
      env: {
        ...process.env,
        WEBHOOK_URL: url,
        WEBHOOK_KEY: "test-key",
        GITHUB_EVENT_PATH: eventPath,
        CURL_CA_BUNDLE: cert,
        SSL_CERT_FILE: cert,
      },
      cwd: work,
    });
    expect(ok).toEqual({
      exitCode: 0,
      stdout: expect.stringContaining(
        "Posted the Nightly End-to-end Run event.",
      ),
      stderr: "",
    });
    expect(hits).toEqual([
      {
        authorization: "Bearer test-key",
        body: eventBody,
      },
    ]);

    const denied = await run({
      file: "bash",
      args: [scriptPath],
      env: {
        ...process.env,
        WEBHOOK_URL: url,
        WEBHOOK_KEY: "test-key",
        GITHUB_EVENT_PATH: eventPath,
        CURL_CA_BUNDLE: cert,
        SSL_CERT_FILE: cert,
      },
      cwd: work,
    });
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain("The webhook returned HTTP 401.");
    expect(hits).toHaveLength(2);
  }, 30_000);

  it("fails before any request when a secret is missing", async () => {
    await using stack = new AsyncDisposableStack();
    const work = await mkdtemp(join(tmpdir(), "nightly-e2e-notify-"));
    stack.defer(async () => {
      await rm(work, { recursive: true, force: true });
    });
    const eventPath = join(work, "event.json");
    await writeFile(eventPath, "{}");
    const scriptPath = join(work, "notify.sh");
    await writeFile(scriptPath, scriptOf(workflow));
    const result = await run({
      file: "bash",
      args: [scriptPath],
      env: {
        ...process.env,
        WEBHOOK_URL: "https://127.0.0.1:9/unused",
        GITHUB_EVENT_PATH: eventPath,
      },
      cwd: work,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY must both be set.",
    );
  });
});
