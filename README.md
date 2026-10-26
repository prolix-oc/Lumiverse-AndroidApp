# Lumiverse Android app

Tauri/Kotlin/Java host, embedded Bun runtime, Android native dependency builders,
and app verification tools. The APK supports local hosting and connecting to a
remote Lumiverse server. Native sources keep their `android/` layout.

## Setup and build

Use Bun 1.4.4, Node.js, Rust/rustup, Android Studio's JDK, Android SDK platform 36
or newer, build tools, and NDK r28c. Native LanceDB builds use Rust 1.97.0.
Configure `ANDROID_HOME`, `JAVA_HOME`, and `ANDROID_NDK_HOME`/`NDK_HOME` when they
are installed outside the build scripts' defaults.

Keep `Lumiverse` beside this checkout, or set `LUMIVERSE_BACKEND_DIR` to
its absolute path. Install that checkout's root and frontend dependencies with
its committed lockfiles. It supplies the server source, production dependency
manifest/lockfile, frontend, and user documentation at build time. The APK's
payload includes those required inputs, with server tests omitted; the app
repository does not duplicate them.

```sh
bun install --frozen-lockfile
bun run build:android-native
bun run build:android-tauri
```

The app uses its own pinned Tauri CLI and icon assets. The APK is written to
`dist/android/lumiverse-tauri-arm64.apk`. Build options include `--offline`,
`--skip-frontend-build`, `--runtime-only`, `--native-dir`, `--bun-zip`, `--sdk`,
and `--java-home`. `build:android-prototype --prepare-only` prepares the verified
runtime payload without invoking the Tauri/Gradle build.

Native dependency outputs live in `dist/native/android-arm64`; download/build
caches live in `.tmp/android-native`. The legacy Termux/glibc builder and its
patches live in `scripts/build-lancedb-android.sh` and `vendor/lancedb-android`;
they are separate from the APK's Android NDK build.

## Remote notifications

Official builds use `android/firebase/google-services.json` for Firebase project
`lumiverse-bc911`, retaining application ID `chat.lumiverse.prototype`. Remote
backends default to the Lumiverse FCM relay without receiving Firebase provider
credentials. The relay must be deployed before releasing these clients. Users
still enable notifications explicitly; local hosting keeps its notification-only
socket and needs no Firebase secrets.

An operator can build with
`LUMIVERSE_ANDROID_FIREBASE_CONFIG=/path/to/google-services.json` to override the
bundled client configuration, then configure matching direct FCM credentials on
their backend. Provider private keys never belong in this repository or APK.
Firebase-project changes renew notification enrollment. Keep the existing
signing key, package and version-code continuity to preserve installed user data.

Relay enrollment verifies device possession through FCM and uses separate
delivery/management capabilities. Content keys and native capabilities are wrapped
with Android Keystore. Both new direct and relay enrollments decrypt authenticated
alerts before using the existing native renderer. Server/account switches clear
the active context immediately; background completion alerts do not depend on a
running WebView. Force-stop still blocks receipt until the app is reopened.

The backend changes must be adopted together with this APK. Update
`backend-source.json` after those changes have a committed revision; the private
nightly controller already builds current backend `staging`. Before rollout,
verify live Firebase delivery and an in-place upgrade over a populated existing
install using the same signing certificate.

## Verify

```sh
bun run test
bun run test:backend
bun run typecheck
bun run scripts/smoke-test-android-connection.ts --serial emulator-5554
bun run scripts/smoke-test-android-prototype.ts --serial emulator-5554 --require-tauri --require-native --attempt-backend
```

`test:backend` tests first-time account setup against the separate backend
checkout in a temporary APK-shaped layout. The optional real-browser download
check is in `scripts/e2e-diagnostics` with its own package manifest; install its
dependencies and Chromium before running `bun run test` there. Its `--baseline`
option reads original app history from the backend repository.

## Local state and source control

The extraction preserves Gradle/Rust build state, downloaded native sources,
existing APKs, and `.tmp/android-prototype/debug.keystore`. Keeping that debug
key allows updates to existing development installs without losing app data.
Generated payloads, compiled libraries, caches, SDK paths, and signing files are
ignored. `LICENSE.md` is retained from the original project. This repository
starts from the extracted source snapshot; original history remains in
Lumiverse. Usage/connection guidance is in `android/README.md`.

## Continuous integration

`.github/workflows/ci.yml` runs independent unit/type checks on every push and
pull request. A separate integration job checks out the exact backend commit in
`backend-source.json` into `backend/`, sets `LUMIVERSE_BACKEND_DIR`, verifies the
checkout revision, and runs `test:backend`. No sibling checkout is needed for
`bun run test` / `bun run test:unit`.

`bun run test:ci` runs all local CI checks, including backend integration. That
command requires the backend checkout. Update the full SHA in
`backend-source.json` intentionally when adopting a newer backend contract;
missing checkouts and revision mismatches fail the integration job. CI does not
skip tests when required shared source is missing. Only the integration job
needs backend dependencies; native app builds and device smoke tests remain
separate from these source-level CI checks.

## Nightly APKs

[Public Android prereleases](https://github.com/prolix-oc/Lumiverse-AndroidApp/releases)
are built daily at 06:53 UTC by the private Lumiverse-Builds controller on the
physical Linux runner. Each build uses the latest Android `main` and backend
`staging` commits, installs their locked dependencies, runs app and backend
integration checks, and rebuilds the production frontend and complete ARM64 APK.
The release records both immutable source revisions, the APK checksum and build
provenance. Ordinary CI continues to use `backend-source.json`.

Nightlies use the existing development signing certificate and increasing
Android version codes, so they can update an installed development APK without
resetting app data. CI sets `LUMIVERSE_ANDROID_VERSION_CODE` and
`LUMIVERSE_ANDROID_VERSION_NAME` together; local builds retain Tauri versioning.
The private controller owns the schedule, SDK/NDK/Java/Rust container, caches and
release credentials. No public pull-request workflow uses the private runner.
