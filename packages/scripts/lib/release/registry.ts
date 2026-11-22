import { setTimeout as delay } from "node:timers/promises";

export const NPM_REGISTRY = "https://registry.npmjs.org/";

interface Packument {
  versions?: Record<string, { dist?: { tarball?: string } }>;
}

export class Registry {
  readonly url: string;

  constructor(url: string) {
    this.url = url.endsWith("/") ? url : `${url}/`;
  }

  async tarball(name: string, version: string): Promise<Buffer | undefined> {
    const response = await fetch(
      `${this.url}${name.replace("/", "%2f")}`,
      noCache,
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(
        `The registry answered ${response.status} for ${name}: ${await response.text()}`,
      );
    }
    const packument = (await response.json()) as Packument;
    const url = packument.versions?.[version]?.dist?.tarball;
    if (!url) return undefined;
    const file = await fetch(url, noCache);
    if (file.status === 404) return undefined;
    if (!file.ok) {
      throw new Error(`The registry answered ${file.status} for ${url}.`);
    }
    return Buffer.from(await file.arrayBuffer());
  }

  async waitFor(
    name: string,
    version: string,
    { timeoutMs = 10 * 60_000, intervalMs = 10_000 } = {},
  ): Promise<Buffer> {
    const deadline = Temporal.Now.instant().epochMilliseconds + timeoutMs;
    for (;;) {
      const tarball = await this.tarball(name, version);
      if (tarball) return tarball;
      if (Temporal.Now.instant().epochMilliseconds >= deadline) {
        throw new Error(
          `${this.url} did not serve ${name}@${version} within ${timeoutMs / 1000} s.`,
        );
      }
      await delay(intervalMs);
    }
  }
}

const noCache = { headers: { "cache-control": "no-cache" } } as const;
