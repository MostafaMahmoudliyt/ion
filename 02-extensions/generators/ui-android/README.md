# ui-android

Android Renderer (kind `ui`). Reads `ui_spec`; writes an Android Studio project (Kotlin, Jetpack Compose, Material 3; minSdk 26).

Open the folder in Android Studio and run, or `gradle assembleDebug` (the Gradle wrapper is not generated: Android Studio or `gradle wrapper` creates it) -> `app/build/outputs/apk/debug/app-debug.apk`.
The Kotlin sources are fixed; they read `app/src/main/assets/ui_spec.json`, so only that asset changes with the spec.

Backend: `buildConfigField` values `ION_API` (base URL of the `api-rest` routes; empty = in-memory demo with every permission), `ION_TOKEN` (bearer), `ION_PERMISSIONS` (comma separated keys from `ui_spec.permissions`). Secure by default: with a backend, nothing is listed until permissions are supplied. HTTPS only (`usesCleartextTraffic=false`).

Screens: menu, list (search, paging), detail, create, edit, archive; Arabic is RTL, with a language switch. Not in this renderer: filters, related items, notifications, activity (web has them).

**Status: this renderer's output has NOT been compiled** (no Android SDK where it was written). Tests check the structure of what is generated (files, manifest, package paths, the spec asset, determinism, no cleartext, no eval-like APIs), not that Gradle builds it. Expect to fix small compile errors on first build.
