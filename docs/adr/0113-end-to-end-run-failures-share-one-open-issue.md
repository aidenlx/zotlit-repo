---
status: accepted
---

# End-to-end Run failures share one open issue

A failed background run reports the commit range from the last passing tip. It adds evidence to the newest open issue whose title exactly matches the shared failure title, or opens one with `needs-triage`. GitHub title search can return near matches, so the runner filters its results. The first pass after a failure records recovery on the same issue. A maintainer closes it.

The runner captures the end of the run log before appending the commit list. Failed Vitest case names appear once in log order even when the runner prints each in both progress and summary. Public issue bodies name logs relative to the state directory to omit the local account path. The GitHub client passes long bodies through `gh --body-file`. Tests fake the run, evidence, GitHub and desktop painting edges.
