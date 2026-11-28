import asyncio
import fcntl
import json
import os
import sys
import tempfile
import time

from pymobiledevice3.cli.webinspector import InspectorJsShell, webinspector_service
from pymobiledevice3.lockdown import create_using_usbmux

BUNDLE = "md.obsidian"
CALL_SECONDS = 15.0
LOCK_PATH = os.path.join(tempfile.gettempdir(), "obsidian-ios-inspector.lock")
EXIT_ERROR, EXIT_NO_ANSWER, EXIT_RELOADED, EXIT_BUSY = 1, 2, 3, 4


def take_device(wait: float):
    handle = open(LOCK_PATH, "a+")
    deadline = time.monotonic() + wait
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            handle.seek(0)
            handle.truncate()
            handle.write(f"pid {os.getpid()} in {os.getcwd()}\n")
            handle.flush()
            return handle
        except BlockingIOError:
            if time.monotonic() >= deadline:
                handle.seek(0)
                print("DEVICE BUSY", handle.read().strip())
                raise SystemExit(EXIT_BUSY)
            time.sleep(1)


async def evaluate(session, expression: str):
    return await asyncio.wait_for(session.runtime_evaluate(expression, return_by_value=True), CALL_SECONDS)


async def run(source: str, timeout: float) -> int:
    lockdown = await create_using_usbmux()
    async with webinspector_service(lockdown) as inspector:
        page = await InspectorJsShell.query_page(inspector, bundle_identifier=BUNDLE)
        if page is None:
            print("NO PAGE: Obsidian is not open on the device")
            return EXIT_NO_ANSWER
        session = await inspector.inspector_session(page.application, page.page)
        await session.runtime_enable()
        origin = await evaluate(session, "performance.timeOrigin")
        start = (
            "globalThis.__probe = {done:false};"
            "(async () => { try { const v = await (" + source + ");"
            " globalThis.__probe = {done:true, value: typeof v === 'string' ? v : JSON.stringify(v)}; }"
            " catch (e) { globalThis.__probe = {done:true, error: String(e && e.stack || e)}; } })(); 'started'"
        )
        await evaluate(session, start)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(0.5)
            raw = await evaluate(
                session, "JSON.stringify({probe: globalThis.__probe ?? null, origin: performance.timeOrigin})"
            )
            state = json.loads(raw) if isinstance(raw, str) else raw
            if abs(state["origin"] - origin) > 1000 or state["probe"] is None:
                print("PAGE RELOADED: the page that ran the expression is gone")
                return EXIT_RELOADED
            probe = state["probe"]
            if probe.get("done"):
                await evaluate(session, "delete globalThis.__probe; 'ok'")
                if "value" in probe:
                    print(probe["value"])
                    return 0
                print("ERROR " + probe.get("error", ""))
                return EXIT_ERROR
        print("TIMEOUT after", timeout, "s: the expression is still running in the page")
        return EXIT_NO_ANSWER


def main() -> None:
    source = open(sys.argv[1]).read() if len(sys.argv) > 1 and sys.argv[1] != "-" else sys.stdin.read()
    timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0
    device = take_device(wait=timeout)
    try:
        code = asyncio.run(asyncio.wait_for(run(source, timeout), timeout + 3 * CALL_SECONDS))
    except (asyncio.TimeoutError, TimeoutError):
        print("NO ANSWER: the inspector did not reply; the page was replaced, the phone is locked, or Obsidian is in the background")
        code = EXIT_NO_ANSWER
    finally:
        fcntl.flock(device, fcntl.LOCK_UN)
    sys.stdout.flush()
    os._exit(code)


main()
