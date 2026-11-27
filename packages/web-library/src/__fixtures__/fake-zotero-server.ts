import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { FakeZoteroApi } from "./fake-zotero-api.ts";

export interface FakeZoteroServer extends AsyncDisposable {
  readonly url: string;
  close(): Promise<void>;
}

export interface FakeZoteroServerOptions {
  readonly host?: string;
  readonly port?: number;
}

async function relay(
  { api, origin }: { api: FakeZoteroApi; origin: string },
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  const response = await api.handle(
    new Request(new URL(incoming.url ?? "/", origin), {
      method: incoming.method ?? "GET",
      headers,
    }),
  );
  const body = Buffer.from(await response.arrayBuffer());
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(body);
}

export async function startFakeZoteroServer(
  api: FakeZoteroApi,
  { host = "127.0.0.1", port = 0 }: FakeZoteroServerOptions = {},
): Promise<FakeZoteroServer> {
  let origin = "";
  const server = createServer((incoming, outgoing) => {
    relay({ api, origin }, incoming, outgoing).catch((error: unknown) => {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
      outgoing.end(Error.isError(error) ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address() as AddressInfo;
  origin = `http://${host}:${address.port}`;
  api.baseUrl = origin;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    }));
  return { url: origin, close, [Symbol.asyncDispose]: close };
}
