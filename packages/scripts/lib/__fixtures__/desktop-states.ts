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
  normal: (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: sessions(uid, false),
  }),
  "lid closed": (uid: number) => ({
    displays: displays(builtIn(true)),
    sessions: sessions(uid, true),
  }),
  "display asleep": (uid: number) => ({
    displays: displays(builtIn(true)),
    sessions: sessions(uid, false),
  }),
  "screen locked": (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: sessions(uid, true),
  }),
  "external display only": (uid: number) => ({
    displays: displays(builtIn(true), external),
    sessions: sessions(uid, false),
  }),
  "another user locked": (uid: number) => ({
    displays: displays(builtIn(false)),
    sessions: JSON.stringify([
      { kCGSSessionUserIDKey: uid + 1, CGSSessionScreenIsLocked: true },
      { kCGSSessionUserIDKey: uid, kCGSSessionOnConsoleKey: true },
    ]),
  }),
} as const;

export type DesktopState = keyof typeof DESKTOP_STATES;
