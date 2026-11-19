// What macOS prints for each desktop state the paint probe tells apart: the
// output of `system_profiler SPDisplaysDataType -json` (trimmed to the read
// keys) and the `IOConsoleUsers` list as JSON. "lid closed" was measured on a
// MacBook with the lid closed and no external display; the other states
// follow the same keys.

interface Display {
  _name: string;
  spdisplays_connection_type?: string;
  spdisplays_online?: string;
  spdisplays_asleep?: string;
}

const builtIn = (asleep: boolean): Display => ({
  _name: "Color LCD",
  spdisplays_connection_type: "spdisplays_internal",
  spdisplays_online: "spdisplays_yes",
  ...(asleep ? { spdisplays_asleep: "spdisplays_yes" } : {}),
});

const external: Display = {
  _name: "LG HDR 4K",
  spdisplays_online: "spdisplays_yes",
};

function displays(...ndrvs: Display[]): string {
  return JSON.stringify({
    SPDisplaysDataType: [
      { _name: "Apple M4 Pro", spdisplays_ndrvs: ndrvs },
    ],
  });
}

/** The console sessions; only a locked session carries the lock key. */
function sessions(uid: number, locked: boolean): string {
  return JSON.stringify([
    {
      kCGSSessionUserIDKey: uid,
      kCGSSessionOnConsoleKey: true,
      kCGSessionLoginDoneKey: true,
      ...(locked
        ? { CGSSessionScreenIsLocked: true, CGSSessionScreenLockedTime: 1 }
        : {}),
    },
  ]);
}

export const DESKTOP_STATES = {
  /** A normal session: the built-in display awake, the screen unlocked. */
  normal: (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: sessions(uid, false),
  }),
  /** The lid closed with no external display: the display sleeps, and macOS locks. */
  "lid closed": (uid: number) => ({
    displays: displays(builtIn(true)),
    sessions: sessions(uid, true),
  }),
  /** The lid open, the display asleep on its idle timer, the session unlocked. */
  "display asleep": (uid: number) => ({
    displays: displays(builtIn(true)),
    sessions: sessions(uid, false),
  }),
  /** The screen locked while the display is on. */
  "screen locked": (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: sessions(uid, true),
  }),
  /** The lid closed with an external display: only the external one is awake. */
  "external display only": (uid: number) => ({
    displays: displays(builtIn(true), external),
    sessions: sessions(uid, false),
  }),
  /** Another user's locked session on the console; this user's is unlocked. */
  "another user locked": (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: JSON.stringify([
      { kCGSSessionUserIDKey: uid + 1, CGSSessionScreenIsLocked: true },
      { kCGSSessionUserIDKey: uid, kCGSSessionOnConsoleKey: true },
    ]),
  }),
} as const;

export type DesktopState = keyof typeof DESKTOP_STATES;
