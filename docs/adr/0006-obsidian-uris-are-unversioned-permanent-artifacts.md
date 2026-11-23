# Obsidian `obsidian://zotlit/*` URIs are unversioned, permanent artifacts

An `obsidian://zotlit/*` link is a public artifact users can embed in notes, webpages, and bookmarks, so it must keep working across plugin versions. We removed the `v` version param from the URL transport entirely: the Zotero builders no longer emit it and the Obsidian receiver no longer checks it — a link is honored whenever its query structurally validates, whatever version created it. The HTTP transport is unchanged: it stays strictly matched via the `X-Zotlit-Protocol-Version` header (`426` on mismatch), because those requests are ephemeral and generated in lockstep by the running companion. `PROTOCOL_VERSION` now means "HTTP wire version" and bumps only on HTTP body/header changes.

## Consequences

- **URL wire format is additive-only.** Existing action ids and their required fields are a frozen contract; future changes may only add optional fields with safe defaults (as `scope` already does). A genuine breaking change requires a **new** action id, with the old handler preserved indefinitely. There is no runtime gate to catch a violation — the discipline is the only guardrail.
- **Structural validation is the sole URL gate** (alongside the version-independent `source-id` install check). A link that no longer parses degrades to the existing "invalid link" notice rather than a "please update" one.
- **A new-Zotero + not-yet-updated-Obsidian pairing briefly rejects v-less links** as "missing version" until the plugin updates. This self-heals and already broke on any prior version bump, so it is an accepted transient, not a regression.

## Source Id and HTTP notification bodies

`packages/protocol/src/source-id.ts` derives the Source Id independently on
both sides from Zotero's profile and data directory file URIs. The sender uses
Gecko's file URI serializer and the receiver uses Node's. The normalizer
removes trailing slashes because Gecko can append one to a directory, folds
the Windows drive letter to uppercase, and normalizes literal Unicode to NFC.
The hash uses djb2a over the two paths separated by a NUL, so different path
pairs cannot give the same hash input just by moving their boundary. It is
encoded as eight lowercase hexadecimal characters. The NFC test uses an
ASCII e followed by combining acute (U+0301) rather than a precomposed é.
[Hash reference](https://github.com/sindresorhus/djb2a/blob/main/index.js)
[Percent-encoded normalization follow-up](https://github.com/aidenlx/zotlit-repo/issues/54)

HTTP sends the id in `X-Zotlit-Source-Id` and the receiver checks it at the
transport edge. Install-specific public links carry `source-id` and require
a known matching install. The Companion can put diagnostic directory paths in
the notification JSON body when debug logging is on. JSON preserves non-ASCII
paths.

The Freshness Signal is a refresh trigger with no item identities. Reader
selection notifications carry the entire selection. A reader-inactive
notification carries no target. The receiver retains the last target and
marks it closed until an active notification names a target again.
[ADR 0024](0024-freshness-signal-follows-the-checkpoint.md)

The Literature Note status response lists Indexed Keys with at least one
note. An absent key means the vault has no Literature Note for that item.
Indexed Keys use the shared Zotero key validator, including the optional
group-library suffix.

## Note and library actions

Each action has its own handler under the `zotlit/` namespace. The single-item
open and update actions share one schema. Batch and import actions have
separate schemas because they carry a list or an import mode. Builders emit
optional parameters when the caller supplies a non-default choice:

- Full update is the default. It refreshes managed frontmatter and managed
  body content. Metadata update changes managed frontmatter only.
- With no placement parameter, the receiver keeps its normal placement.
  For a note, it replaces the last active tab. A caller can choose a new
  tab, a split, or a desktop pop-out.
- The batch URL accepts comma-separated decimal item ids with a trailing
  comma. It removes duplicate ids and requires at least one. When a batch is
  too large for a URL, the Companion sends it through the HTTP fallback for
  Literature Note updates or Zotero note imports. The fallback carries
  integer ids in the body and the Source Id in the header.
- Library-wide updates and imports name exactly one library, regardless of
  the receiver's configured discovery scope. Zero or an absent library
  parameter names the personal library. An optional collection limits the
  action to that collection and its descendants. A collection key uses the
  same Zotero key format as an item key. Library-wide imports collect both
  child and standalone notes.
- `show-in-library` uses the Indexed Key, which follows the Item across
  synced devices. It omits the install-specific Source Id so a link in a
  note can work on each device. The `zt.librarylink` template variable builds
  this form.
- `explore` can anchor on an annotation key. `open-attachment` accepts an
  item or attachment id and resolves the file on the receiver.
- `import-profile` requests a clipboard handoff. The Profile document stays
  outside the URI.

The HTTP version applies to the notification, status, update, and import
schemas. The wire-surface test keeps a single snapshot so schema changes can
be reviewed together.

## Shared Zotero keys and Zotero links

`packages/zotero-types/src/keys.ts` validates the upstream eight-character
item alphabet in one place. The Indexed Key parser splits out the group
suffix before validation. This also protects queries that reach Zotero's
Local API, where a malformed parent key can give unrelated results.
[Zotero key alphabet](https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1729)
[Zotero key validator](https://github.com/zotero/utilities/blob/86948f960557c18eb6489ebe228b820957d13cf0/utilities.js#L1741-L1746)

`packages/zotero-types/src/uri.ts` uses keys in Zotero's own `select` and
`open` links, so attachment format does not decide the link scheme. An
annotation link carries the attachment key and a separate annotation key,
plus an optional page hint. Its parser returns bare keys and the optional
group id. The caller can construct an Indexed Key if it needs cross-library
identity. A personal-library link has no group id.

## Launch from Zotero

The Companion uses Zotero's external launcher for Obsidian links so Zotero checks the registered OS handler and clears its Mozilla environment variables. Gecko 140.15 requires the triggering principal that older Zotero calls omit. Affected builds can raise `NS_ERROR_ILLEGAL_VALUE` before reaching the OS handler. The Companion preserves Zotero's default path, propagates other error results, and uses the host's external protocol service for that compatibility case. The host supplies the relevant Services members even though the sandbox types omit them. The regression test exercises both the normal and fallback paths. [Zotero launcher](https://github.com/zotero/zotero/blob/10.0.2/chrome/content/zotero/xpcom/zotero.js) · [Gecko external protocol launcher](https://hg.mozilla.org/releases/mozilla-esr140/file/FIREFOX_140_15_0esr_RELEASE/uriloader/exthandler/nsExternalHelperAppService.cpp#l1012)

The Companion sends a batch by URI up to 2,000 characters to avoid OS-handler truncation on some platforms. Larger batches use a PUT to the Obsidian listener. A PUT cannot bring Obsidian forward, so the Companion uses a progress window to tell the user to continue there. If no listener is reachable, it points to the server setting. Both batch and Literature Note status requests distinguish HTTP 426 so the user can update incompatible plugin versions. A source mismatch on a Literature Note status request returns a bodyless HTTP 204. For note status it keeps the existing cache, since a successful status response contains a valid key list. The listener accepts a batch PUT with HTTP 204. A batch PUT discarded at the Source Id gate returns a bodyless HTTP 409, and the Companion tells the user about the mismatch. [Batch rejection feedback](https://github.com/aidenlx/zotlit-repo/issues/95)

The pane placement preference stores `active` to represent the default in the literal preferences file. It omits placement on the wire for that value or an unrecognized value, so the receiver follows its default.

## Run and notice boundary

Validate the source hash at the URI boundary. Give `update-many` its own action because it decodes a list of IDs. Send that list to the batch runner, which owns database readiness, classification, and confirmation. Refuse an invalid Profile selector at the boundary so an explicit choice cannot become Default.

Run pushes through the same flows as their URI counterparts. Give each push a fiber in the host Scope so a long batch leaves the next request free to run. Unload closes the streams, interrupts work in progress, and stops modal callbacks through the scoped bridge. Report the stream as idle when intake has ended and all admitted work has settled. Publish outcomes after the notice step. Interruption has no outcome.

Use the common Notifier timing for preflight results and errors. A successful open presents the note directly. A foreign-source request is silent. The batch update notice shows the diagnostic for a preflight refusal or a general failure message for other preflight errors. [Note link handlers](../../packages/notes/src/desktop/protocol/handlers.ts) · [Batch update notice follow-up](https://github.com/aidenlx/zotlit-repo/issues/154)

For an action that opens one Item, parse the query and validate its Source
ID, wait until the database leaves loading, and resolve the Item while the
database is ready. The shared handler distinguishes malformed links, foreign
sources, unavailable databases, and missing Items. Feature handlers can add
their own outcomes. A successful open and a foreign-source request are silent
in the shared notice mapping.
[Protocol helpers](../../packages/plugin-services/src/obsidian/protocol/link.ts)

Validate Live Update protocol and source headers before dispatch. Deliver
the batch Item IDs to the subscriber that owns their resolution and
confirmation UI. Acknowledge the request without waiting for that UI.
Schedule dispatch on a later task so the interactive work can run outside
the request handler. The test polls for dispatch because its task uses a
different queue from timers.

Wait for the Note Index's first full scan before returning Literature Note
keys. If the wait ends because the service stopped, return HTTP 404 so the
Companion keeps its prior status. Returning a partial set as HTTP 200 would
tell the Companion that unscanned notes do not exist.
[Live Update routes](../../packages/plugin-services/src/obsidian/local-server/live-update-app.ts)

The End-to-end Run stages an incoming link in localStorage before loading
its Probe Plugin. The probe mirrors launch dispatch through window.OBS_ACT
when the dispatcher is absent. It lets Obsidian dispatch after layout
ready and records notices from load onward.
[Launch-link probe](../../packages/e2e/fixtures/launch-link-plugin/main.ts)

Load the launch-link probe before ZotLit for a reload test, matching
the main process that sets the link before any plugin loads.

Keep action constants independent of body imports so the entry can
register them early. Follow Obsidian's one-handler-per-verb convention.
Batch actions have their own query shapes, and library-wide import
shares the scope of update-all while collecting both child and
standalone notes. The attachment handler accepts either a regular
Item or an Attachment and opens the corresponding PDF. Library View
links use a synced Indexed Key, with no source identity. Decimal wire
values carry a numeric Zotero Item ID. Collection keys use the same
object-key format as Item keys.
[Action constants](../../packages/protocol/src/actions.ts)

## Amendment (2026-11-23): a discarded batch PUT answers 409 in protocol version 9

The listener answers a batch PUT that the Source Id gate discards with a bodyless HTTP 409 (`SOURCE_MISMATCH_STATUS` in `@zotlit/protocol`). The Companion then shows a source-mismatch message. A Literature Note status GET and a `/notify` POST with a different Source Id keep the bodyless 204. Request bodies and headers stay the same, so `PROTOCOL_VERSION` stays 9.

Accepted limit: an older Companion reads the 409 as a failed response and shows its generic failure message, with no mismatch reason. In all four pairings of old and new versions, an accepted batch returns 204 and shows the handoff.

Rejected: a `PROTOCOL_VERSION` bump. No request body or header changes, and no pairing loses a result it had before. A bump would also make the version gate answer HTTP 426 to every request from an older Companion.

The change is landing from branch `fix/companion-ops-92-94-95-154`. [Issue 95](https://github.com/aidenlx/zotlit-repo/issues/95)
