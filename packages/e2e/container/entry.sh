#!/bin/bash
set -euo pipefail

step=source
host_results=${ZOTLIT_E2E_HOST_RESULTS:-$ZOTLIT_E2E_RESULTS}
exec 3>&2
trap 'if [[ -r /sys/fs/cgroup/memory.peak ]]; then cat /sys/fs/cgroup/memory.peak >"$ZOTLIT_E2E_RESULTS/memory-peak.bytes"; fi' EXIT
trap 'code=$?
  if [[ $step != run || ! -f "$ZOTLIT_E2E_RESULTS/results.json" ]]; then
    printf "Run Container failed at %s (exit %s). See %s/%s.log\n" "$step" "$code" "$host_results" "$step" >&3
  fi
  exit "$code"' ERR

{
  tar --create --directory=/source --no-recursion --null --files-from=- |
    tar --extract --no-same-owner
  git init -q
  # Supply the copied files to Turbo and the bundle freshness check.
  git add -f -- .
} 2>"$ZOTLIT_E2E_RESULTS/source.log"

step=install
pnpm install --frozen-lockfile --prefer-offline --store-dir=/pnpm-store 2>&1 |
  tee "$ZOTLIT_E2E_RESULTS/install.log"

step=display
export HOME=/tmp/run-home DISPLAY=:99 XDG_RUNTIME_DIR=/tmp/run-runtime
export XDG_CONFIG_HOME="$HOME/.config"
export LIBGL_ALWAYS_SOFTWARE=1
mkdir -m 700 "$HOME" "$XDG_RUNTIME_DIR"
Xvfb "$DISPLAY" -screen 0 1280x1024x24 -noreset >"$ZOTLIT_E2E_RESULTS/display.log" 2>&1 &
for ((attempt=0; attempt<100; attempt++)); do
  if xwd -root -silent -out /dev/null >/dev/null 2>&1; then break; fi
  sleep 0.1
done
xwd -root -silent -out /dev/null >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1
herbstluftwm --autostart /bin/true >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1 &
for ((attempt=0; attempt<100; attempt++)); do
  if herbstclient version >/dev/null 2>&1; then break; fi
  sleep 0.1
done
herbstclient version >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1
# Keep the vault's viewport stable when Obsidian opens a pop-out.
herbstclient floating on >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1
herbstclient rule focus=on >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1
if [[ "${ZOTLIT_E2E_VNC:-}" ]]; then
  x11vnc -display "$DISPLAY" -rfbport 5900 -nopw -forever -shared >>"$ZOTLIT_E2E_RESULTS/display.log" 2>&1 &
fi

step=run
export ZOTLIT_RUN_CONTAINER=1 ZOTLIT_E2E_REQUIRED=1
export ZOTLIT_TOOLCHAIN="node-$(node --version)"
node packages/scripts/scripts/memory-gate.ts -- pnpm exec turbo run e2e --filter=@zotlit/e2e -- "$@" 2>&1 |
  tee "$ZOTLIT_E2E_RESULTS/run.log"
