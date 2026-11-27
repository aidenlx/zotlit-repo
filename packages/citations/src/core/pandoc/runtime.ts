import type { Inode } from "@bjorn3/browser_wasi_shim";
import {
  ConsoleStdout,
  File as WasiFile,
  OpenFile,
  PreopenDirectory,
  WASI,
} from "@bjorn3/browser_wasi_shim";
import { Effect } from "effect";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

export interface PandocLogMessage {
  type: string;
  verbosity: string;
  pretty: string;
}

export type VirtualFiles = Readonly<Record<string, string | Uint8Array>>;

export interface PandocOptions {
  "output-file"?: string;
  [option: string]: unknown;
}

export interface PandocConvertResult {
  stdout: string;
  stderr: string;
  messages: PandocLogMessage[];
  outputFile?: Uint8Array;
}

export interface PandocRuntime {
  convert(
    options: PandocOptions,
    stdin: string | null,
    files: VirtualFiles,
  ): PandocConvertResult;
}

interface PandocExports {
  memory: WebAssembly.Memory;
  __wasm_call_ctors: () => void;
  malloc: (size: number) => number;
  hs_init_with_rtsopts: (argcPtr: number, argvPtr: number) => void;
  convert: (optionsPtr: number, optionsLength: number) => void;
}

const RTS_ARGS = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"];

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Instantiate the Pandoc binary against a fresh in-memory filesystem.
 *
 * Adapted from the official `pandoc-wasm` bridge, narrowed to the conversion
 * path: virtual files arrive as bytes rather than Blobs, which keeps `convert`
 * synchronous, and media extraction is left out.
 *
 * @param wasmBinary the verified `pandoc.wasm` binary.
 * @see https://github.com/pandoc/pandoc-wasm/blob/v1.1.0/src/core.js
 */
export async function createPandocRuntime(
  wasmBinary: Blob | Uint8Array<ArrayBuffer>,
): Promise<PandocRuntime> {
  const fileSystem = new Map<string, Inode>();
  const wasi = new WASI(
    RTS_ARGS,
    [],
    [
      new OpenFile(new WasiFile(new Uint8Array(), { readonly: true })),
      ConsoleStdout.lineBuffered((line) =>
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Pandoc stdout").pipe(
            Effect.annotateLogs({ line }),
            withLogCategory("pandoc"),
          ),
        ),
      ),
      ConsoleStdout.lineBuffered((line) =>
        Effect.runSyncWith(logServices)(
          Effect.logDebug("Pandoc stderr").pipe(
            Effect.annotateLogs({ line }),
            withLogCategory("pandoc"),
          ),
        ),
      ),
      new PreopenDirectory("/", fileSystem),
    ],
    { debug: false },
  );

  const response = new Response(wasmBinary, {
    headers: { "Content-Type": "application/wasm" },
  });
  const { instance } = await WebAssembly.instantiateStreaming(response, {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  const exports = instance.exports as unknown as PandocExports;
  wasi.initialize({ exports });
  exports.__wasm_call_ctors();
  initHaskellRuntime(exports);

  return {
    convert(options, stdin, files) {
      const optionsBytes = encoder.encode(JSON.stringify(options));
      const optionsPtr = writeBytes(exports, optionsBytes);

      const stdout = new WasiFile(new Uint8Array());
      const stderr = new WasiFile(new Uint8Array());
      const warnings = new WasiFile(new Uint8Array());
      fileSystem.clear();
      fileSystem.set(
        "stdin",
        new WasiFile(encoder.encode(stdin ?? ""), { readonly: true }),
      );
      fileSystem.set("stdout", stdout);
      fileSystem.set("stderr", stderr);
      fileSystem.set("warnings", warnings);
      for (const [name, data] of Object.entries(files)) {
        const bytes = typeof data === "string" ? encoder.encode(data) : data;
        fileSystem.set(name, new WasiFile(bytes, { readonly: true }));
      }
      const outputName = options["output-file"];
      if (outputName !== undefined) {
        fileSystem.set(outputName, new WasiFile(new Uint8Array()));
      }

      exports.convert(optionsPtr, optionsBytes.length);

      const output =
        outputName === undefined ? undefined : fileSystem.get(outputName);
      return {
        stdout: decoder.decode(stdout.data),
        stderr: decoder.decode(stderr.data),
        messages: parseMessages(decoder.decode(warnings.data)),
        outputFile:
          output instanceof WasiFile && output.data.length > 0
            ? output.data
            : undefined,
      };
    },
  };
}

function initHaskellRuntime(exports: PandocExports): void {
  const argPtrs = RTS_ARGS.map((arg) => writeCString(exports, arg));
  const argv = exports.malloc(4 * (RTS_ARGS.length + 1));
  const argcPtr = exports.malloc(4);
  const argvPtr = exports.malloc(4);

  const view = new DataView(exports.memory.buffer);
  argPtrs.forEach((ptr, index) => view.setUint32(argv + 4 * index, ptr, true));
  view.setUint32(argv + 4 * RTS_ARGS.length, 0, true);
  view.setUint32(argcPtr, RTS_ARGS.length, true);
  view.setUint32(argvPtr, argv, true);

  exports.hs_init_with_rtsopts(argcPtr, argvPtr);
}

function writeBytes(exports: PandocExports, bytes: Uint8Array): number {
  const ptr = exports.malloc(bytes.length);
  new Uint8Array(exports.memory.buffer).set(bytes, ptr);
  return ptr;
}

function writeCString(exports: PandocExports, text: string): number {
  const bytes = encoder.encode(text);
  const ptr = exports.malloc(bytes.length + 1);
  const memory = new Uint8Array(exports.memory.buffer);
  memory.set(bytes, ptr);
  memory[ptr + bytes.length] = 0;
  return ptr;
}

function parseMessages(raw: string): PandocLogMessage[] {
  if (raw === "") return [];
  try {
    return JSON.parse(raw) as PandocLogMessage[];
  } catch (error) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning("Pandoc wrote an unreadable log").pipe(
        Effect.annotateLogs({ raw, error }),
        withLogCategory("pandoc"),
      ),
    );
    return [];
  }
}
