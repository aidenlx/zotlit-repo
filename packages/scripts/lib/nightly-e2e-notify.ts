import { parse } from "yaml";

export const NIGHTLY_E2E_NOTIFY_WORKFLOW =
  ".github/workflows/nightly-e2e-notify.yml";

const NOTIFY_NAME = "Notify Grok Bot of Nightly End-to-end Run";
const WORKFLOW_NAME = "Nightly End-to-end Run";

const WEBHOOK_ENV = {
  WEBHOOK_URL: "${{ secrets.GROK_BOT_WEBHOOK_URL }}",
  WEBHOOK_KEY: "${{ secrets.GROK_BOT_WEBHOOK_KEY }}",
} as const;

const REQUIRED_IN_SCRIPT = [
  "set -euo pipefail",
  "GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY must both be set.",
  "The GitHub event file is missing or empty.",
  "umask 077",
  "mktemp -d",
  "Authorization: Bearer ${WEBHOOK_KEY}",
  "curl -q",
  "--proto '=https'",
  "--connect-timeout 10",
  "--max-time 30",
  "--header 'Content-Type: application/json'",
  '--header @"$workdir/authorization"',
  '--data-binary @"$GITHUB_EVENT_PATH"',
  "--write-out '%{http_code}'",
  '--url "$WEBHOOK_URL"',
  "The webhook returned HTTP ",
  "Posted the Nightly End-to-end Run event.",
] as const;

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
        const step = steps[0] as {
          env?: Record<string, unknown>;
          run?: unknown;
        };
        if (!sameKeys(step, ["env", "name", "run"])) {
          problems.push(
            "the post step must set only its name, the webhook env, and its run script",
          );
        }
        const env = step.env;
        if (
          !sameKeys(env, ["WEBHOOK_URL", "WEBHOOK_KEY"]) ||
          env?.WEBHOOK_URL !== WEBHOOK_ENV.WEBHOOK_URL ||
          env.WEBHOOK_KEY !== WEBHOOK_ENV.WEBHOOK_KEY
        ) {
          problems.push(
            "the post step must read only GROK_BOT_WEBHOOK_URL and GROK_BOT_WEBHOOK_KEY from the environment",
          );
        }
        const script = step.run;
        if (typeof script !== "string" || !script.startsWith("set +x\n")) {
          problems.push(
            "the post step must turn off trace before it reads the secrets",
          );
        } else {
          for (const snippet of REQUIRED_IN_SCRIPT) {
            if (!script.includes(snippet)) {
              problems.push(
                `the post step must include ${JSON.stringify(snippet)}`,
              );
            }
          }
          if (
            script.includes("actions/checkout") ||
            script.includes("download-artifact") ||
            script.includes("github.token") ||
            script.includes("--insecure") ||
            script.includes(" -k ") ||
            script.includes("--location") ||
            script.includes(" -L ")
          ) {
            problems.push(
              "the post step must not check out code, follow redirects, or skip TLS",
            );
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

export function scriptOf(text: string): string {
  const problems = nightlyE2eNotifyProblems(text);
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
  const workflow = parse(text) as {
    jobs: { notify: { steps: Array<{ run: string }> } };
  };
  const script = workflow.jobs.notify.steps[0]?.run;
  if (typeof script !== "string") {
    throw new Error("the notify job must have one step");
  }
  return script;
}
