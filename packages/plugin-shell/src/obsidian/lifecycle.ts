import { Plugin } from "obsidian";

import { releaseKeyDescription } from "#core/release-key.ts";

export const PREVIOUS_RELEASE_WAIT_MS = 10_000;

const releaseKey = (id: string) => Symbol.for(releaseKeyDescription(id));

export class UnloadAwarePlugin extends Plugin {
  #unloaded = false;
  #released?: Promise<void>;

  get unloaded(): boolean {
    return this.#unloaded;
  }

  async waitForPreviousAndHoldRelease(
    stack: AsyncDisposableStack,
  ): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<void>();
    stack.defer(resolve);
    this.#released = promise;
    const previous: unknown = Reflect.get(
      this.app,
      releaseKey(this.manifest.id),
    );
    if (!(previous instanceof Promise)) return false;
    let timer: number | undefined;
    const timedOut = await Promise.race([
      previous.then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = window.setTimeout(
          () => resolveTimeout(true),
          PREVIOUS_RELEASE_WAIT_MS,
        );
      }),
    ]);
    window.clearTimeout(timer);
    return timedOut;
  }

  override register(...[callback]: Parameters<Plugin["register"]>): void {
    if (this.#unloaded) callback();
    else super.register(callback);
  }

  override unload(): void {
    this.#unloaded = true;
    if (this.#released)
      Reflect.set(this.app, releaseKey(this.manifest.id), this.#released);
    super.unload();
  }
}
