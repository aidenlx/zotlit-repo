import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NIGHTLY_E2E_NOTIFY_WORKFLOW,
  nightlyE2eNotifyProblems,
  nightlyE2eNotifyReport,
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
      ).length,
    ).toBeGreaterThan(0);
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
    expect(
      nightlyE2eNotifyProblems(
        once(workflow, "on:\n  workflow_run:", "on:\n  push:\n  workflow_run:"),
      ),
    ).toEqual([expect.stringContaining("only on workflow_run")]);
  });

  it("reports permissions, checkout, a success filter, and a hardcoded URL", () => {
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
          "timeout-minutes: 2\n    permissions: {}",
          "timeout-minutes: 2\n    permissions:\n      contents: read",
        ),
      ),
    ).toEqual([expect.stringContaining("job permissions must be {}")]);
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
        once(workflow, "timeout-minutes: 2", "timeout-minutes: 50"),
      ),
    ).toEqual([expect.stringContaining("2 minutes")]);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "    permissions: {}\n    steps:",
          "    permissions: {}\n    if: github.event.workflow_run.conclusion == 'success'\n    steps:",
        ),
      ),
    ).toEqual([expect.stringContaining("only runs-on")]);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "set +x\n",
          "set +x\n          echo https://example.com/hook\n",
        ),
      ),
    ).toEqual([expect.stringContaining("must not hardcode a webhook URL")]);
  });

  it("reports a post step that traces, drops bearer transport, or filters the conclusion", () => {
    expect(
      nightlyE2eNotifyProblems(
        once(workflow, "curl -q --config", "curl --config"),
      ),
    ).toEqual([expect.stringContaining('must include "curl -q --config')]);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "        run: |",
          "        shell: bash -x {0}\n        run: |",
        ),
      ),
    ).toEqual([expect.stringContaining("only its name")]);
    expect(
      nightlyE2eNotifyProblems(
        once(
          workflow,
          "set +x\n",
          'set +x\n          if (run.conclusion === "success") process.exit(1)\n',
        ),
      ),
    ).toEqual([expect.stringContaining('must not include "\\"success\\""')]);
  });
});

describe("nightlyE2eNotifyReport", () => {
  it("posts the unchanged event with bearer auth and refuses a bad event before any request", async () => {
    expect(await nightlyE2eNotifyReport(workflow)).toEqual([]);
  }, 60_000);
});
