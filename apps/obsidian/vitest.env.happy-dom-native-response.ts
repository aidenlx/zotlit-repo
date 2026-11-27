import type { Environment } from "vitest/runtime";
import { builtinEnvironments } from "vitest/runtime";

const happyDom = builtinEnvironments["happy-dom"];

export default {
  ...happyDom,
  name: "happy-dom-native-response",
  async setup(global, options) {
    const nativeResponse = global.Response;
    const nativeBlob = global.Blob;
    const nativeFile = global.File;
    const teardown = await happyDom.setup(global, options);
    global.Response = nativeResponse;
    global.Blob = nativeBlob;
    global.File = nativeFile;
    return teardown;
  },
} satisfies Environment;
