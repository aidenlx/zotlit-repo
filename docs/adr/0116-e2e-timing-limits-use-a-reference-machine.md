---
status: accepted
---

# E2E timing limits use a reference machine

The Run Container gives tests the same software on the Mac and on GitHub Actions. The host still determines CPU speed and can delay work while it runs other jobs. On the first GitHub ARM64 run, both citation cases produced the expected results. Citation Index exceeded its maximum response time, and Citation Scan exceeded both median limits. The same checks met their limits on the MacBook in an isolated run. [GitHub Actions run](https://github.com/aidenlx/zotlit-repo/actions/runs/45007867479)

## Decision

The ordinary End-to-end Run checks results and reports timings for Citation Index, Citation Scan, Item Index rebuilds, and batch note updates. GitHub Actions uploads the reports with the run evidence. The same rules apply to local E2E, release E2E, and post-land E2E.

Use the optional `pnpm e2e:performance` command when evaluating a performance change or investigating a timing regression. Run it on the reference MacBook with other test and build jobs stopped. It runs the files with these cases in a Run Container and enforces the existing limits for frame and task delays, search and count responses, the worker timer, and scan CPU time. CI, land, and release use ordinary E2E.

Apply this split to new E2E cases with limits that depend on host performance. Keep assertions for results and progress in the ordinary cases. Use the reference run to enforce the timing budgets.

## Reference baseline

The baseline ran on an Apple M4 Pro MacBook (`Mac16,8`) with 12 CPU cores and 24 GiB of RAM. Docker Desktop ran the `linux/arm64` image in a VM with 12 vCPUs and 7.75 GiB of RAM. The Run Container had a 4 GiB memory limit. The baseline used one Run Container at a time.

## Consequences

GitHub provides functional coverage and timing reports for its own runner class. The reference MacBook provides the result for the timing budgets. [ADR 0068](0068-the-zotero-database-runs-in-a-web-worker-behind-zoteroreads.md) · [ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md)
