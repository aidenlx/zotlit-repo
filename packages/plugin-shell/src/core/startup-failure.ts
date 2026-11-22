import { Cause, Effect, Layer } from "effect";

export class ServiceStartupFailed extends Error {
  override readonly name = "ServiceStartupFailed";

  readonly service: string;
  override readonly cause: Cause.Cause<unknown>;

  constructor(service: string, cause: Cause.Cause<unknown>) {
    super(`${service} failed to start`);
    this.service = service;
    this.cause = cause;
  }
}

export function startingAs(service: string) {
  return <A, R>(layer: Layer.Layer<A, never, R>): Layer.Layer<A, never, R> =>
    layer.pipe(
      Layer.catchCause((cause) =>
        Layer.effectContext<A, never, never>(
          Cause.hasInterruptsOnly(cause) ||
            Cause.squash(cause) instanceof ServiceStartupFailed
            ? Effect.failCause(cause)
            : Effect.die(new ServiceStartupFailed(service, cause)),
        ),
      ),
    );
}
