import { buildApp } from './build.ts';
import type { AppBuild } from './build.ts';
import type { UappSpec } from './publish-engine.ts';
import type { SpecSet } from './specs.ts';
export interface IonBundle {
    ion_bundle: {
        ion_version: string;
        app: UappSpec['uapp_spec']['app'];
        manifest_hash: string;
        specs: Record<string, unknown>;
    };
}
export declare function createBundle(built: AppBuild): IonBundle;
export declare const bundleText: (b: IonBundle) => string;
export declare const bundleFileName: (b: IonBundle) => string;
export declare function openBundle(text: string): {
    bundle: IonBundle;
    specs: SpecSet;
    uapp_spec: UappSpec;
};
export { buildApp };
export declare const sha256: (s: string) => string;
