// Android Renderer (constitution sections 6, 51, 64). An Extension, not Core.
// ui_spec -> an Android Studio project (Kotlin + Jetpack Compose). Deterministic: same ui_spec => same bytes.
// The Kotlin sources are fixed and read assets/ui_spec.json at run time; only that asset (and the package name) vary.
import { DATA_KT, MAIN_KT, SCREENS_KT, SPEC_KT } from './kotlin.ts';

type Obj = Record<string, any>; // validated spec JSON

export const PACKAGE = 'com.ion.app';
const dir = PACKAGE.replace(/\./g, '/');
const src = (kt: string): string => kt.replace(/\bPKG\b/g, PACKAGE);

export function generate(specs: Obj): Record<string, string> {
  const ui = specs.ui_spec.ui_spec;
  const kt = `app/src/main/kotlin/${dir}`;
  return {
    'settings.gradle.kts': 'pluginManagement {\n    repositories { google(); mavenCentral(); gradlePluginPortal() }\n}\ndependencyResolutionManagement {\n    repositories { google(); mavenCentral() }\n}\nrootProject.name = "IonApp"\ninclude(":app")\n',
    'build.gradle.kts': 'plugins {\n    id("com.android.application") version "8.5.2" apply false\n    id("org.jetbrains.kotlin.android") version "2.0.20" apply false\n    id("org.jetbrains.kotlin.plugin.compose") version "2.0.20" apply false\n}\n',
    'gradle.properties': 'org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=true\nkotlin.code.style=official\n',
    'app/build.gradle.kts': [
      'plugins {', '    id("com.android.application")', '    id("org.jetbrains.kotlin.android")', '    id("org.jetbrains.kotlin.plugin.compose")', '}', '',
      'android {', `    namespace = "${PACKAGE}"`, '    compileSdk = 35', '    defaultConfig {', `        applicationId = "${PACKAGE}"`, '        minSdk = 26', '        targetSdk = 35', '        versionCode = 1', '        versionName = "1.0.0"',
      '        // Backend: empty API = in-memory demo. Set per build type for a real backend.',
      '        buildConfigField("String", "ION_API", "\\"\\"")', '        buildConfigField("String", "ION_TOKEN", "\\"\\"")', '        buildConfigField("String", "ION_PERMISSIONS", "\\"\\"")', '    }',
      '    buildFeatures { compose = true; buildConfig = true }',
      '    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }',
      '    kotlinOptions { jvmTarget = "17" }', '}', '',
      'dependencies {', '    implementation(platform("androidx.compose:compose-bom:2024.09.03"))', '    implementation("androidx.compose.material3:material3")', '    implementation("androidx.compose.ui:ui")',
      '    implementation("androidx.activity:activity-compose:1.9.2")', '    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")', '}', '',
    ].join('\n'),
    'app/src/main/AndroidManifest.xml': [
      '<?xml version="1.0" encoding="utf-8"?>', '<manifest xmlns:android="http://schemas.android.com/apk/res/android">', '    <uses-permission android:name="android.permission.INTERNET" />',
      '    <application android:label="Ion App" android:supportsRtl="true" android:usesCleartextTraffic="false" android:theme="@android:style/Theme.Material.Light.NoActionBar">',
      '        <activity android:name=".MainActivity" android:exported="true">', '            <intent-filter>', '                <action android:name="android.intent.action.MAIN" />', '                <category android:name="android.intent.category.LAUNCHER" />', '            </intent-filter>', '        </activity>', '    </application>', '</manifest>', '',
    ].join('\n'),
    'app/src/main/assets/ui_spec.json': JSON.stringify(ui, null, 2) + '\n',
    [`${kt}/MainActivity.kt`]: src(MAIN_KT),
    [`${kt}/Spec.kt`]: src(SPEC_KT),
    [`${kt}/Data.kt`]: src(DATA_KT),
    [`${kt}/Screens.kt`]: src(SCREENS_KT),
  };
}
