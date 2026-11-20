export interface Inflation {
  readonly bytes: number;
  readonly decodeMs: number;
  readonly ms: number;
}

export const inflations: { started: number; readonly finished: Inflation[] } = {
  started: 0,
  finished: [],
};

const originalAtob = globalThis.atob;
const OriginalDecompressionStream = globalThis.DecompressionStream;
let decodeStarted = 0;

globalThis.atob = (data: string): string => {
  decodeStarted = performance.now();
  return originalAtob(data);
};

globalThis.DecompressionStream = class {
  readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
  readonly writable: WritableStream<BufferSource>;
  constructor(format: CompressionFormat) {
    const real = new OriginalDecompressionStream(format);
    this.writable = real.writable;
    if (format !== "deflate-raw") {
      this.readable = real.readable;
      return;
    }
    inflations.started++;
    const started = decodeStarted;
    const decodeMs = performance.now() - started;
    let bytes = 0;
    this.readable = real.readable.pipeThrough(
      new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          controller.enqueue(chunk);
        },
        flush() {
          inflations.finished.push({
            bytes,
            decodeMs,
            ms: performance.now() - started,
          });
        },
      }),
    );
  }
};

export const inflateSpy: Disposable = {
  [Symbol.dispose]: () => {
    globalThis.atob = originalAtob;
    globalThis.DecompressionStream = OriginalDecompressionStream;
  },
};
