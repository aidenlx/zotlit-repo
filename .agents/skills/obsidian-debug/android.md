# Obsidian on Android

The Mac drives Obsidian's WebView over adb and the Chrome DevTools Protocol, on an emulator or a USB device. Scripts in [`mobile/`](mobile/) do the evaluation.

## Tools, installed globally

The SDK, the JDK and the AVD live in the standard global places, so every worktree shares one install:

```sh
brew install openjdk@21
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --licenses
sdkmanager platform-tools emulator 'system-images;android-35;google_apis;arm64-v8a'
printf 'no\n' | avdmanager create avd -n ZotLitAndroid -k 'system-images;android-35;google_apis;arm64-v8a'
```

The AVD lands in `~/.android/avd`. Check first whether `avdmanager list avd` already lists `ZotLitAndroid`.

## Boot and install

1. Start the emulator in the background and keep it running:
   `emulator -avd ZotLitAndroid -no-window -no-audio -no-snapshot -memory 2560 -gpu swiftshader_indirect -no-metrics`.
   If a sandboxed launch exits with signal 4 before boot, run it with access to Hypervisor.framework outside the command sandbox (`emulator -accel-check`).
2. Wait for boot: `adb wait-for-device`, then until `adb shell getprop sys.boot_completed` prints `1`. With several devices, pass `-s <serial>` from `adb devices -l` to every adb call.
3. Install the official APK: `gh release download -R obsidianmd/obsidian-releases --pattern '*.apk'`, then `adb install -r <apk>`. Record `adb shell getprop ro.build.version.release` and the WebView provider from `adb shell dumpsys webviewupdate`. The emulator image ships an old WebView (124 on Android 15 Google APIs); a real device updates it through the Play Store, so report the version beside every result.

## Attach

1. Launch and forward the app's DevTools socket. Repeat after every force-stop, because the PID changes:

   ```sh
   pid=$(adb shell pidof md.obsidian | tr -d '\r')   # empty: adb shell am start -W -n md.obsidian/.MainActivity
   adb forward --remove tcp:9224; adb forward tcp:9224 localabstract:webview_devtools_remote_$pid
   ```

2. Evaluate a file or stdin with [`mobile/cdp-eval.mjs`](mobile/cdp-eval.mjs) (`node mobile/cdp-eval.mjs <file|-> [seconds]`). It sends `Runtime.evaluate` with `awaitPromise` and prints the value or `ERROR <exceptionDetails>`. The origin is `http://localhost`.
3. A fresh install opens on onboarding, and the WebView is already attachable there. Create a disposable vault by clicking through it in the page: "Create a vault" → "Continue without sync" → set the name input (dispatch an `input` event) → click "App storage" → "Create a vault". Then confirm `app.vault.getName()`.

## Move files and run a plugin build

The emulator reaches the Mac at `10.0.2.2`: serve the files with `python3 -m http.server 8765 --bind 127.0.0.1`, fetch them in the page with the global `requestUrl`, and write them with `app.vault.adapter.writeBinary`. Install and enable a plugin build as in [ios.md](ios.md) ("Run a plugin build").

## Workers and errors

pdf.js and other libraries run in Blob-URL Workers, whose console the page never sees. [`mobile/cdp-watch.mjs`](mobile/cdp-watch.mjs) evaluates a file while it auto-attaches every Worker (`Target.setAutoAttach` with `flatten`) and prints their exceptions and console output, tagged `W` (worker) or `P` (page). `Log.enable` replays old page entries first; read the `W` lines and the entries after your action.

A view's own state is the source of truth for a load: a Reader can resolve `whenReady()` with a failed document, so read `reader.state.get().status` and `failure`.

## Start-up time and memory

- **Start-up:** relaunch from the Mac (`adb shell am force-stop md.obsidian`, then `am start -W -n md.obsidian/.MainActivity`), re-forward, and read the breakdown with [`mobile/startup-time.js`](mobile/startup-time.js). Emulator times run on a software GPU; compare them with each other, not with a device.
- **Memory:** the page runs in the WebView renderer process, not in `md.obsidian`. Find it with `adb shell ps -A | grep sandboxed_process` and read `adb shell dumpsys meminfo <pid>` (TOTAL PSS / RSS). `performance.memory` gives the JS heap only.

## Clean up

`adb forward --remove-all`, `adb emu kill`, and stop the file server. Keep the global SDK and AVD for the next run. Report the target (emulator or device), the Android and WebView versions, and the results.
