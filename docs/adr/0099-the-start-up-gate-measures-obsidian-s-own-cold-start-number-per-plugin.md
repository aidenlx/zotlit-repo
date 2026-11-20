---
status: accepted
---

# The start-up gate measures Obsidian's own cold-start number per plugin

## Context

ZotLit and ZotLit Reader load at every vault start. Obsidian loads community plugins one at a time, in the order of `community-plugins.json`, and awaits each before the next and before `vault.load` and `loadLayout` (Obsidian 1.15.1 `app.js` 124691-124718, 159958-159976). So each millisecond a plugin spends there delays the vault for every user, and the cold start, the first start of the day, is the case users wait for.

Obsidian already measures this. It records a mark `communityPlugins.<id>` in the `finally` of `enablePlugin` (124769): the wall time from the previous mark through reading and evaluating `main.js`, `new Plugin(app, manifest)`, the awaited `onload` and `loadCSS`. It shows the marks in the "Startup time" modal, under Settings → General → "Check for slow startup", and through `dev:startup format=json` (71505-71531). `onLayoutReady` callbacks run after that mark (122808-122822), but the 1.15 start-up snapshot stays on screen until 100 ms after they finish, or 1500 ms at most (159384-159388).

On desktop Obsidian loads `main.js` through an `app://` script tag with the V8 code cache (124534). A start with unchanged bytes reuses the compiled code; the first start after an update compiles it again. Line numbers are for Obsidian 1.15.1's `app.js`, extracted with the `obsidian-asar-extract` skill.

## Decision

- **One number: Obsidian's.** The gate reads `communityPlugins.<id>` from Obsidian's own start-up record, the number a user sees in the "Startup time" modal. It also records the time from layout ready until the start-up snapshot goes, for the `onLayoutReady` cost.
- **Cold start is the gated case.** `pnpm measure:startup` quits Obsidian and launches it again, with each plugin measured alone in a vault that enables only that plugin, in two modes: the **daily start** (unchanged `main.js` bytes, so the code cache applies) and the **first start after an update** (new bytes). The warm reload stays as a trend, not a gate.
- **A budget per plugin and mode.** `PUBLISHED_PLUGINS` in `packages/scripts/lib/shell/plugins.ts` holds each plugin's budgets beside its `main.js` budget. Each budget comes from a valid measurement with headroom, and the owner sets it.
- **A valid measurement only.** The gate measures on an idle machine with a painting desktop under the Exclusive Hold of the Desktop Slot. On a busy machine it refuses with exit 75 and the reason, as the Desktop Slot does for a locked screen. A refusal is a blocked run, not a failed gate.
- **The gate runs at release.** `pnpm verify --release` runs it under its own Exclusive Hold, after the End-to-end Run releases its slot. Each End-to-end Run records the trend.
- **Cuts follow a profile.** A change made for start-up time names the cost it removes in a CPU profile of the daily cold start, split into the module top level, `onload`, `loadCSS` and the `onLayoutReady` work, and shows the median before and after.
- **One stylesheet per plugin.** Each plugin ships one `styles.css` that Obsidian loads at start-up. A split or lazy stylesheet is built only when the profile shows that `loadCSS` and the style recalculation it causes are a cost the other cuts cannot meet.

## Considered

- **Our own clock around `onload`.** Rejected: it leaves out reading and evaluating `main.js` and `loadCSS`, and differs from what users and Obsidian's slow-start notice see.
- **A reload as the cold start.** Rejected as the gate: `location.reload()` keeps the main process and the file cache, and new bytes on each load measure only the first start after an update.
- **Both plugins in one measured start.** Rejected: work one plugin does not await is counted against the next.
- **A gate in every `pnpm verify`.** Rejected: a relaunch of Obsidian needs the whole desktop for minutes, and a wall-clock gate on a shared machine fails for reasons outside the code.

## Consequences

- A cold-start failure means the code got slower on an idle machine, and the report names the plugin, the mode and the budget.
- The `main.js` size budget stays as a separate check in every `pnpm verify`: size still costs the read and, after an update, the compile.
- A change in Obsidian's start-up record is read again from the extracted `app.js` of the new version, and the gate follows it.
