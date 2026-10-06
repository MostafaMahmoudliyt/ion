# ui-ios

iOS Renderer (kind `ui`). Reads `ui_spec`; writes a SwiftUI app (iOS 16+) and an [XcodeGen](https://github.com/yonaskolb/XcodeGen) `project.yml`.

The generated Xcode project is pinned to the Xcode 15.3 project format for compatibility with the Xcode 15.4 toolchain on the macOS 14 runner.

On a Mac: `brew install xcodegen && xcodegen generate && open IonApp.xcodeproj`, then Archive in Xcode for an IPA (you supply your signing team).
The Swift sources are fixed; they read `Resources/ui_spec.json`, so only that file changes with the spec.

Backend: Info.plist keys `ION_API` (base URL of the `api-rest` routes; empty = in-memory demo with every permission), `ION_TOKEN` (bearer), `ION_PERMISSIONS` (comma separated keys from `ui_spec.permissions`). Secure by default: with a backend, nothing is listed until permissions are supplied. App Transport Security stays on (HTTPS only).

Screens: menu, list (search, paging), detail, create, edit, archive; Arabic is RTL, with a language switch. Not in this renderer: filters, related items, notifications, activity (web has them).

**Status: compiled by CI** for the iOS Simulator on macOS 14 with Xcode 15.4. CI does not sign or archive the app; an IPA still requires your signing team. Tests also check the generated structure, determinism and absence of dynamic-code APIs.
