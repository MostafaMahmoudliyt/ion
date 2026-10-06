// iOS Renderer (constitution sections 6, 52, 63). An Extension, not Core.
// ui_spec -> an iOS app: Swift + SwiftUI sources and an XcodeGen project.yml (no hand-written .xcodeproj, which is not text-diffable).
// The Swift sources are fixed and read Resources/ui_spec.json at run time. Deterministic: same ui_spec => same bytes.
import { APP_SWIFT, DATA_SWIFT, SPEC_SWIFT, VIEWS_SWIFT } from './swift.ts';

type Obj = Record<string, any>; // validated spec JSON

export const BUNDLE_ID = 'com.ion.app';

export function generate(specs: Obj): Record<string, string> {
  const ui = specs.ui_spec.ui_spec;
  const project = [
    'name: IonApp',
    'options:', '  bundleIdPrefix: com.ion', '  projectFormat: xcode15_3', '  deploymentTarget:', '    iOS: "16.0"',
    'targets:',
    '  IonApp:', '    type: application', '    platform: iOS',
    '    sources: [Sources, Resources]',
    '    settings:', '      base:', `        PRODUCT_BUNDLE_IDENTIFIER: ${BUNDLE_ID}`, '        SWIFT_VERSION: "5.9"', '        GENERATE_INFOPLIST_FILE: NO',
    '    info:', '      path: Info.plist', '      properties:',
    '        CFBundleDisplayName: Ion App',
    '        UILaunchScreen: {}',
    '        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait, UIInterfaceOrientationLandscapeLeft, UIInterfaceOrientationLandscapeRight]',
    '        # Backend: empty API = in-memory demo. App Transport Security stays on (HTTPS only).',
    '        ION_API: ""', '        ION_TOKEN: ""', '        ION_PERMISSIONS: ""',
    '',
  ].join('\n');
  return {
    'project.yml': project,
    'Resources/ui_spec.json': JSON.stringify(ui, null, 2) + '\n',
    'Sources/IonApp.swift': APP_SWIFT,
    'Sources/Spec.swift': SPEC_SWIFT,
    'Sources/Data.swift': DATA_SWIFT,
    'Sources/Views.swift': VIEWS_SWIFT,
  };
}
