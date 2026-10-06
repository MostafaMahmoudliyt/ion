export interface UappManifest {
    uapp: {
        ion_version: string;
        app: {
            id: string;
            name: string;
            domain: string;
        };
        source_manifest_hash: string;
        entries: Array<{
            generator: string;
            version: string;
            kind: string;
            path: string;
            files: Array<{
                path: string;
                sha256: string;
                bytes: number;
            }>;
        }>;
    };
}
export declare const MANIFEST_FILE = "manifest.json";
export interface UappResult {
    dir: string;
    files: Record<string, string>;
    manifest: UappManifest;
}
export declare function buildUapp(bundleText: string, extensionsDir: string, generatorIds?: string[]): Promise<UappResult>;
