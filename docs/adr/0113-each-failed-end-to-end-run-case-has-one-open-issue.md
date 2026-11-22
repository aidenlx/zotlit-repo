---
status: accepted
---

# Each failed End-to-end Run case has one open issue

Each failed case of the nightly has one open issue: the run adds evidence to it, or opens it with `needs-triage`. A maintainer closes it. The report names the tip and links the Actions run.

Until 22 November 2026 every failure went to one issue. Unrelated failures were then hard to triage there. A run after each land reported to the same issues until it was retired ([ADR 0115](0115-the-end-to-end-run-runs-in-a-container-of-its-own.md)). The one issue, with the shared failure title, stays for a run that names no failed case and for a run in which more than five cases fail: a case that breaks the run vault fails the rest of its file, and a failed app start fails every case. Those are one cause, and an issue for each case would hide it. If several such issues are open, the newest one whose title matches exactly gets the report.

The case ID is the file, the blocks and the title of the case, from the JSON results of Vitest. The issue holds a hash of the ID in an HTML comment in its body, so a maintainer can rename the issue, and an ID can be longer than an issue title. The reporter lists the open issues and matches them itself: the title search of GitHub returns near matches and lags behind a new issue.

The GitHub client passes long bodies through `gh --body-file`. Tests fake the GitHub edge.
