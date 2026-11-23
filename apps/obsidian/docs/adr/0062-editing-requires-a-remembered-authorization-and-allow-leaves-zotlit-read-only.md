# Editing requires a Remembered Authorization; Zotero's Allow leaves ZotLit read-only

Zotero's write dialog offers Allow, Always Allow, and Deny. Allow issues a key that Zotero spends on the first authenticated write, whether or not that write succeeds. ZotLit edits only after the researcher confirms a remembered grant in Obsidian. When Zotero answers `remember: false`, ZotLit discards the key, the Editing Capability stays at authorization required, and a notice says **To edit annotations, choose Always Allow in Zotero.** with an **Allow editing** button that asks again. The waiting state says **In Zotero, choose Always Allow, then confirm in Obsidian. ZotLit cannot edit with Allow. To decline, choose Deny.**

A single-use key pays for one write request. Supporting it took its own capability state, a manual-save rule for comment drafts, and special cases in the card controls and the creation toolbar. It cannot serve a group action, which sends one request per Annotation and fails from the second. Zotero always shows Allow and gives the client no way to hide it, so ZotLit cannot prevent the choice; it refuses the key and says what to choose instead.

Accepted on 2026-09-25 with [#1243](https://github.com/aidenlx/zotlit/issues/1243), before release, so no stored state needed migration. It amends [ADR 0038](0038-write-authorization-starts-only-from-a-user-gesture.md), [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md), and [ADR 0059](0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md).

## Considered Options

- **Hold Allow's key and spend it on the next write** (previous choice): one change without a lasting grant, at the cost of the separate state and save rules above, and no group actions.
- **Ask Zotero again at once after Allow** (rejected): opens Zotero's dialog with no action in Obsidian, against ADR 0038, and Zotero allows five prompts a minute.
- **Spend the refused key with a write built to fail** (rejected): removes the key from Zotero's store, but depends on the order of Zotero's internal checks.
- **Refuse Allow's key and say to choose Always Allow** (chosen).
- **Trust `remember: true`** (previous): enables editing for any remembered grant, including the grant Zotero issues on dismissal.
- **Ask Zotero to move Always Allow off the cancel slot** (upstream): Zotero controls button placement and dismissal behavior.
- **Ask in Obsidian after a remembered grant** (chosen): save the grant only after the researcher confirms it.

## Consequences

- Allow's key stays in Zotero's key store. An unused single-use key has no expiry, and the Local API has no revoke; Zotero's **Clear** removes it. The key permits only writes to a database every local process can already read, the reasoning of [ADR 0037](0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md).
- When the key from Always Allow cannot be saved to SecretStorage, ZotLit discards it too and says **ZotLit could not save the permission on this device.** Zotero keeps that remembered key until it is cleared.
- Every **Allow editing** entry reports the answer the same way: a saved grant, an Allow, or a failed save each show their notice. When the researcher denies or declines a grant, the capability returns to **Allow editing** without a notice.
- Comment drafts always save automatically. A held draft still waits for an explicit **Save comment** (ADR 0048).
- Closing ZotLit's confirmation keeps ZotLit read-only and leaves Zotero's remembered key unused. The Local API has no revoke route. Zotero's **Clear** removes this key as it does an unused Allow key.

A grant requires confirmation and a successful save. A grant discarded at either step leaves the capability at authorization required, as a denial or an Allow does. [Capability mapping](../../../../packages/annotations/src/obsidian/annotation-repository/capability.ts)

Show a brief confirmation when the grant is saved. An unremembered Allow response offers another user-initiated authorization attempt. A grant the device could not save has its own notice. Other refusals are shown by the capability status. [Authorization notices](../../../../packages/annotations/src/obsidian/annotation-repository/capability-notices.ts)

Recognize the same edit keys in the creation surfaces and in the blocked-gesture path. Keep shortcuts with Control, Command, or Alt and text-entry keystrokes in their host paths. A blocked gesture first probes again because Zotero may have reopened. Report the current block after the probe. [Editing Capability affordance](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/capability-affordance.ts)

The blocked edit notice follows the probe's completion. An authorized gesture stays with the Reader. An unauthorized session still requires explicit approval.

Give the Editing Capability priority over a lock on a keyboard edit. Recheck it when a drag releases because capability can lapse while the pointer is down. Shared gesture recognition keeps a color shortcut and its blocked notice in agreement. An ordinary blocked control press responds every time, while repeated blocked keyboard gestures report once per reason per capability episode. The held draft's approval action opens the settings row directly.

A blocked placement gesture reports the current reason without creating. Editing shortcuts cannot arm or recolor an unavailable control. The binding owns the blocked-key notice. An already armed tool must recheck capability when the pointer releases, since editing can become unavailable after the press.

The Reader toolbar's status affordance shows authorizing and cooldown. Direct approval lives in the Annotation View and settings.

If editing already works, let the gesture act without a blocked notice. Otherwise probe and send a report for the Attachment. A report never invokes authorization. Allow editing remains an explicit action in settings.

When the researcher closes Zotero's dialog, Gecko returns button index 1.
Zotero records that answer as Always Allow and sends a remembered grant.
ZotLit asks for confirmation in Obsidian and saves the grant after the
researcher selects **Turn on editing**.

Paired Zotero 10.0 supplied the fixture replies for Allow, Always Allow,
Deny, and dismissal. Two dismissal methods returned the same remembered
grant shape. Keep those captures distinct from contract-derived cases.
[Authorization tests](../../../../packages/plugin-services/src/obsidian/zotero-local-api/authorization.test.ts)

### Paired Local API authorization proof

Send Zotero's allowed-request header for the native client. A
browser-like request can fail without a status. Keep loopback
requests direct so a proxy does not substitute its own response.
Wait for Better BibTeX's readiness endpoint because Zotero's
server starts before Better BibTeX registers it. Read the database
ID dynamically because it belongs to the Fixture database.

Reset remembered keys and the authorization rate window between
cases. A running Zotero can keep its empty key cache after
authorization clears. Seed remembered access through its endpoint
and scripted Always Allow to keep cache and file consistent.
Use response fields and remembered key count to verify what
the endpoint did. Restore the original prompt function and
verify no test property remains.

Use RDP during the Gecko dialog and select buttons by slot
because the OS locale can change their labels. A dismissed
dialog can take the second slot, which means Always Allow.
Explicitly choose Deny when teardown finds a prompt. Return a
JSON value from evaluated RDP code so its poll can settle.

[Paired Local API helper](../../../../packages/e2e/src/paired-zotero.ts)

For the annotation lesson, clear the Paired Run authorization
because the learner starts without it. Clear the device secret
using Obsidian's runtime API. Reload ZotLit over a recorder so
its startup patch wraps the recorder instead of letting a link
open the computer's Zotero. Arrange teardown so an unanswered
approval dialog cannot block the next run. Always Allow is the
second dialog button. Confirm the remembered grant in Obsidian.

[Annotation authorization lesson](../../../../packages/e2e/src/docs-walks/annotate-pdfs-in-obsidian.walk.ts)

### Authorization proof tiers

First verify Local API reads without a dialog or debugging port.
Then use the real authorize route with an RDP prompt stub and
separate checks against the real dialog. The stub chooses a
branch and the endpoint and remembered key count prove its
result. A single-use grant leaves the remembered count at zero.
The missing Server ID is rejected before body parsing or a
prompt. After resetting Zotero's keys, replace the seeded
authorization in the test vault too.

Drive the real dialog by button slot because the host locale
controls its labels. Confirm the window actually opened.
On failure, press Deny so the outstanding request can finish.
Gecko's dismissal selects the second slot and can persist an
Always Allow grant. The proof records that Zotero behavior.
ZotLit waits for confirmation in Obsidian before it uses that grant.
[Issue 180](https://github.com/aidenlx/zotlit-repo/issues/180)

Stub Always Allow for the ZotLit write cases so they can focus
on the write path. Obtain the key from Zotero's endpoint and
verify it is held before writing. Read the resulting record
from Zotero.

[Authorization tiers](../../../../packages/e2e/src/paired-run.e2e.ts)

Place the remembered-key reset case after the cases that
use the block's key. It clears both stores and can leave a
fresh Always Allow key. Check the settings row from the
main window and exercise retry through the notice's button.

[Paired authorization retry](../../../../packages/e2e/src/paired-run.e2e.ts)
