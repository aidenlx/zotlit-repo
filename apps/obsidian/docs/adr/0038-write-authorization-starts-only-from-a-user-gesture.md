# Write Authorization starts from Allow editing

Zotero grants Write Authorization through its own modal dialog: Allow, Always Allow, and Deny, with Deny the default. ZotLit requests it through the explicit **Allow editing** action in the Annotation View or settings, when the Zotero Local API is available and authorization is needed. Editing controls stay disabled until authorization is available. This separates approval from changing an Annotation, so selecting an editing tool has a predictable result.

One authorization request belongs to the plugin and survives navigation between views. The Annotation View and settings show **Waiting for approval in Zotero** and prevent duplicate requests. The user completes or declines the request in Zotero. A denial or connection failure ends that attempt; another request requires Allow editing. A write that reports expired authorization also returns to this explicit action. Approval makes editing available; a subsequent editing action submits a change.

Accepted on 2026-09-20. This replaces the earlier choice to authorize from an edit gesture. The decision is a target contract; implementation must be checked against it. Amended by [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md): only Always Allow enables editing.

## Considered Options

- **Authorize at startup or on the Capability Probe** (rejected): a Zotero dialog would appear with no visible cause in Obsidian, and a `401` from a revoked key would re-prompt on its own.
- **Explicit Allow editing, editing controls disabled until approval** (chosen): adds a separate approval action and lets the researcher decide when Zotero opens its dialog.
- **An outbox that holds refused writes for later** (rejected): needs visible pending items, cancellation, reconciliation, and conflict rules that no ticket in this map defines.
- **Authorization from an edit gesture** (previous choice): reduced the number of actions, but selecting an editing tool could unexpectedly open Zotero's dialog.

## Consequences

- Only Always Allow enables editing. Zotero's Allow issues a single-use key that ZotLit discards, leaving editing unavailable, as defined in [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md).
- The authorization request waits for Zotero's response across view closure. The initial interface directs the user to Zotero's Always Allow or Deny buttons. Client cancellation cannot promise to close Zotero's dialog; native dialog dismissal is not classified as denial without a verified result. Zotero limits prompts to five per minute, and a `429` keeps the action disabled for `Retry-After`.
- A `403 Write access denied` marks that one library read-only in memory for the session, cleared by the next Capability Probe; no key is requested again for it.
- The Client Name shown in Zotero's dialog is `ZotLit for Obsidian`, one string for every vault.
- The settings row **Zotero editing** leads with the current editing outcome and the relevant next step. Connection availability and a saved authorization remain separate facts. **Ready to edit** replaces the authorization action when editing is available. **Forget authorization** is a secondary management action. A failed connection says **Cannot connect to Zotero**; Local API setup guidance requires evidence that the API is disabled.

The [Zotero Local API documentation](https://www.zotero.org/support/dev/web_api/v3/local_api#authorizing_writes) defines approval and key consumption. Local source inspection confirms that authentication consumes a one-time key before later write checks. A successful read establishes connection availability, not the validity of a remembered write grant; [ADR 0037](0037-a-remembered-authorization-is-a-per-device-secret-bound-to-the-zotero-server-id.md) governs that distinction.

Each Annotation View pane can report its own blocked editing gesture or request authorization. Run those requests concurrently so a gesture in one pane does not replace a request from another. [Capability command](../../../../packages/annotations/src/desktop/annot-view/atoms.ts)

Recheck card controls at a press so the notice reflects the current lock or Editing Capability. A group action aggregates the controls of its Selected Cards. A pending write can disable the action. A blocked action can use the press to explain the block and offer authorization where available. Confirm Delete before writing, and include the card count for a group. [Card action controls](../../../../packages/annotations/src/desktop/annot-view/actions.tsx)

Keep blocked card verbs pressable, since the press presents the notice that explains the block. A pending write can disable the control. Evaluate the cooldown when drawing a card or opening its menu. The toolbar owns the live countdown. [Annotation Card](../../../../packages/annotations/src/desktop/annot-view/Annotation.tsx)

The card and the Mark Popup share a presentation function that returns controls as data. A blocked control keeps its verb as its tooltip. Pressing it gives a notice with the capability's detail or label, and offers Allow editing only when authorization can lift the block. A cooldown's reason uses the time the surface reads it. A pending gesture write takes priority and uses the saving label. Copy and Reveal remain separate from editing gates. The creation surfaces use the same reason rule. [Shared controls](../../../../packages/annotations/src/obsidian/annot-view/card-controls.ts) · [Blocked notice](../../../../packages/annotations/src/obsidian/annot-view/card-verbs.ts)

## Editing Capability precedence and copy

The Local API version is the compatibility gate. Record the schema version for diagnosis. A known read-only Library outranks authorization and a pending dialog. In an available session a remembered Write Authorization outranks the dialog cooldown, which limits new requests. The pending dialog displays its own state. Treat an expired cooldown as authorization required. A write whose answer was lost can report that Zotero is unavailable without inferring what write took effect. Read endpoints do not send a record version or write token, and an empty list is valid. A conflict, reused write token or missing record belongs to the mutation path when it comes from a write, and is an invalid response to a capability read.

Compare the capability reason independently of the cooldown deadline. Callers that schedule a refresh or display remaining time also compare the deadline. Read the clock on each countdown update, round a partial second up, and clamp an expired wait to zero. Plain and Effect callers can share the copy function through epoch milliseconds.

Render the labels, tone, icons and spinner state from one mapping across settings, the toolbar and the sidebar. Treat probing as busy. Authorization uses the same pencil as the writable state and exposes the action. The reader's authorization affordance combines the label and detail into its tooltip. It disappears when the ordinary editing tools take over or the capability is read-only. Tests compare states to Message keys and cover the cooldown boundary. [Capability](../../../../packages/annotations/src/obsidian/annotation-repository/capability.ts) · [Capability copy](../../../../packages/annotations/src/obsidian/annotation-repository/capability-copy.ts)

## Notice and settings lifetimes

A blocked editing gesture starts a quiet period per Attachment. Show each distinct reason once until a probe or another gesture finds the Attachment writable. Key cooldown by its reason so the countdown cannot repeat the notice. A second cooldown within the same period stays quiet if that reason already appeared. An invalid or incompatible request gets a persistent rollback notice, with the shared capability copy as its detail. A read-only Library refusal gets a notice once per Library. Reset that record when a probe retires the write refusal so the enabled control and its explanation become available together.

The settings row separates checking the connection, asking for authorization, and forgetting the key. A remembered key can be forgotten even while Zotero is closed. An active check owns its status and cleanup. Refresh the countdown each second during cooldown. A capability event redraws status immediately and triggers a fresh keystore read because the keystore has no independent event. A newer read supersedes one in flight. A failed read leaves the prior key state visible. [Notice decisions](../../../../packages/annotations/src/obsidian/annotation-repository/capability-notices.ts) · [Settings row](../../../../packages/annotations/src/obsidian/annotation-repository/editing-settings-row.ts)

Keep notice presentation separate from triggering it so debug callers can render the same notice directly. Read notice timing from the layer clock. Run a notice button's action in the layer Scope so it stops on unload. Expose awaitable commands at the plain-code boundary. Wait for the probe before opening Zotero editing settings so the row reads the latest capability, and resolve the authorization command after its answer and any notice. A retry from an Allow response requires a separate user press. [Notices](../../../../packages/annotations/src/obsidian/annotation-repository/notices.ts) · [Plain-code handle](../../../../packages/annotations/src/obsidian/annotation-repository/notices-handle.ts)

Log Editing Capability when its reported reason changes for a given Attachment or session, so repeated reads of one state need no additional log entry. [Repository state](../../../../packages/annotations/src/obsidian/annotation-repository/core/state.ts)

Local API list reads require no Write Authorization. Session-level settings report the capability without applying a refusal tied to a specific Attachment's Library. Log each capability read at trace and a changed reason or cooldown deadline at debug. The deadline distinguishes rate-limit events in logs while notices use one reason for the cooldown. [Capability reads](../../../../packages/annotations/src/obsidian/annotation-repository/core/lists.ts)

Publish a capability event separately from record updates. Consumers can re-read the Attachment's capability without replacing its Annotation list. [Repository events](../../../../packages/annotations/src/obsidian/annotation-repository/core/model.ts)

The session capability describes the connection and authorization gesture. The Attachment capability adds library write refusals, which apply only to that Attachment. [Repository service](../../../../packages/annotations/src/obsidian/annotation-repository/service.ts)

The writable harness normally seeds Remembered Authorization and lets the initial capability probe select the source. Providing the authorization option explicitly as undefined models a session with no remembered grant.

## Authorization request lifetime

Probe first and return an existing authorization without raising another
dialog or consuming a prompt slot. Concurrent gestures wait on one request
owned by the session Scope. The dialog has no timeout and a caller leaving
does not cancel that request. Publish the pending state after claiming the
slot. On completion, clear the slot, settle its waiters, then publish the
new capability. Discard a grant that is single-use or cannot be saved.

Read a grant fresh from the keystore for each write. An absent grant
returns unauthorized without prompting. A revoked key returns the session
to authorization required. Remember a Library write refusal only until
the next probe because permissions may have changed. Announce retirement
so the surface can refresh the control and report a new refusal when it
happens. Reprobe after an incompatible version or database change. Publish
edit refusals separately from list changes so the caller can roll back and
show the reason. During rendering, read the write state without a trace.
[Authorization session](../../../../packages/plugin-services/src/obsidian/zotero-local-api/session.ts)

The authorization tests await the adoption event when a failed write
starts a new probe. This checks the public signal without assuming how
many times the event loop turns. Starting a session learns its first
database without emitting a database-change event. Another probe of the
adopted database stays quiet.
[Authorization state tests](../../../../packages/plugin-services/src/obsidian/zotero-local-api/authorization.test.ts)
