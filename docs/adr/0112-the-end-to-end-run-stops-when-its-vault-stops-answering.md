---
status: accepted
---

# The End-to-end Run stops when its vault stops answering

One broken Query View window caused 27 downstream failures and consumed about 15 minutes. Keep a stop record per test file and run vault so subsequent cases can report the first failure immediately.

The guard checks leftovers after each case. A reply shows the vault can still answer. If that check receives no reply, or the case failed before the check, make one bounded liveness call. A failed liveness call marks the vault stopped. The CLI then rejects calls for that vault in the same file before they spend another timeout. Other files and other vaults continue.

Report both errors when a case and its disposal fail. Read aggregate errors and both arms of a suppressed error so a cleanup exception preserves the original case failure. Each unit test imports the guard and CLI client afresh, since their stop state is kept in module scope for the life of a test file.
