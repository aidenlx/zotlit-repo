---
status: accepted
---

# Each failed End-to-end Run case has one open issue

A failed background run reports the commit range from the last passing tip. Each failed case has one open issue: the run adds evidence to it, or opens it with `needs-triage`. The run after a land and the nightly share these issues. The first pass after a failure records recovery on each issue that failed since the last pass and is still open. A maintainer closes it.

Until 22 November 2026 every failure went to one issue. Unrelated failures were then hard to triage there, since two reporters wrote to it. The one issue, with the shared failure title, stays for a run that names no failed case and for a run in which more than five cases fail: a case that breaks the run vault fails the rest of its file, and a failed app start fails every case. Those are one cause, and an issue for each case would hide it. If several such issues are open, the newest one whose title matches exactly gets the report.

The case ID is the file, the blocks and the title of the case, from the JSON results of Vitest. The log prints a case in a different form in each environment. The issue holds a hash of the ID in an HTML comment in its body, so a maintainer can rename the issue, and an ID can be longer than an issue title. The reporter lists the open issues and matches them itself: the title search of GitHub returns near matches and lags behind a new issue. A run writes its results to a folder of its own, so a run that ends early reports no case of an earlier run.

The runner captures the end of the run log before appending the commit list. Public issue bodies name logs relative to the state directory to omit the local account path. The GitHub client passes long bodies through `gh --body-file`. Tests fake the run, evidence and GitHub edges.
