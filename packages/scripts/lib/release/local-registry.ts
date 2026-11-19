// A local npm registry for the packages a release publishes: it serves the
// tarballs put into it, in the registry's own format, so pnpm resolves and
// installs them exactly as it does from registry.npmjs.org. The dry run of
// `pnpm release:publish` publishes the bundle package here in place of npm,
// and the tests of the release flow use it as the registry.
//
// Only the scopes routed to it reach it (`@scope:registry=<url>`); every other
// package still comes from the public registry.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);

interface Version {
  readonly manifest: Record<string, unknown> & {
    name: string;
    version: string;
  };
  readonly tarball: Buffer;
}

export interface LocalRegistry {
  /** The registry URL, with a trailing slash. */
  readonly url: string;
  /** Serves the package in `tarball` from now on. */
  publish(tarball: string, distTag: string): Promise<void>;
  close(): Promise<void>;
}

/** `sha512-<base64>`, the integrity npm and pnpm record for a tarball. */
export function tarballIntegrity(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** The package.json inside an npm tarball. */
export async function tarballManifest(
  tarball: string,
): Promise<Record<string, unknown> & { name: string; version: string }> {
  const { stdout } = await run(
    "tar",
    ["-xzOf", tarball, "package/package.json"],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout) as Record<string, unknown> & {
    name: string;
    version: string;
  };
}

export async function startLocalRegistry(): Promise<LocalRegistry> {
  const packages = new Map<
    string,
    { versions: Map<string, Version>; tags: Record<string, string> }
  >();
  const server = createServer((request, response) => {
    const path = decodeURIComponent(
      new URL(request.url ?? "/", "http://registry").pathname,
    ).slice(1);
    const tarballAt = path.indexOf("/-/");
    const name = tarballAt === -1 ? path : path.slice(0, tarballAt);
    const entry = packages.get(name);
    if (request.method !== "GET" || !entry) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"Not found"}');
      return;
    }
    if (tarballAt !== -1) {
      const file = path.slice(tarballAt + 3);
      const version = [...entry.versions.values()].find(
        ({ manifest }) => tarballName(manifest) === file,
      );
      if (!version) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(version.tarball);
      return;
    }
    const versions = Object.fromEntries(
      [...entry.versions].map(([number, { manifest, tarball }]) => [
        number,
        {
          ...manifest,
          dist: {
            tarball: `${url}${name}/-/${tarballName(manifest)}`,
            integrity: tarballIntegrity(tarball),
            shasum: createHash("sha1").update(tarball).digest("hex"),
          },
        },
      ]),
    );
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ name, "dist-tags": entry.tags, versions }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  return {
    url,
    async publish(tarball, distTag) {
      const manifest = await tarballManifest(tarball);
      const entry = packages.get(manifest.name) ?? {
        versions: new Map<string, Version>(),
        tags: {},
      };
      if (entry.versions.has(manifest.version)) {
        throw new Error(
          `${manifest.name}@${manifest.version} is in the registry already; a version is published once.`,
        );
      }
      entry.versions.set(manifest.version, {
        manifest,
        tarball: await readFile(tarball),
      });
      entry.tags[distTag] = manifest.version;
      packages.set(manifest.name, entry);
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** `name-1.2.3.tgz`, without the scope, as npm names a tarball. */
function tarballName(manifest: { name: string; version: string }): string {
  return `${manifest.name.split("/").at(-1)}-${manifest.version}.tgz`;
}
