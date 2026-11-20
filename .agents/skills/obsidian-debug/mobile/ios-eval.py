import asyncio
import json
import sys

from pymobiledevice3.cli.webinspector import InspectorJsShell, webinspector_service
from pymobiledevice3.lockdown import create_using_usbmux

BUNDLE = "md.obsidian"


async def main() -> None:
    source = open(sys.argv[1]).read() if len(sys.argv) > 1 and sys.argv[1] != "-" else sys.stdin.read()
    timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 120.0
    lockdown = await create_using_usbmux()
    async with webinspector_service(lockdown) as inspector:
        page = await InspectorJsShell.query_page(inspector, bundle_identifier=BUNDLE)
        if page is None:
            raise SystemExit("no Obsidian page")
        session = await inspector.inspector_session(page.application, page.page)
        await session.runtime_enable()
        start = (
            "globalThis.__probe = {done:false};"
            "(async () => { try { const v = await (" + source + ");"
            " globalThis.__probe = {done:true, value: typeof v === 'string' ? v : JSON.stringify(v)}; }"
            " catch (e) { globalThis.__probe = {done:true, error: String(e && e.stack || e)}; } })(); 'started'"
        )
        await session.runtime_evaluate(start, return_by_value=True)
        waited = 0.0
        while waited < timeout:
            await asyncio.sleep(0.5)
            waited += 0.5
            raw = await session.runtime_evaluate("JSON.stringify(globalThis.__probe)", return_by_value=True)
            state = json.loads(raw) if isinstance(raw, str) else raw
            if state and state.get("done"):
                await session.runtime_evaluate("delete globalThis.__probe; 'ok'", return_by_value=True)
                print(state.get("value") if "value" in state else "ERROR " + state.get("error", ""))
                return
        print("TIMEOUT after", timeout, "s")


asyncio.run(main())
