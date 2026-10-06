import type { UappSpec } from './publish-engine.ts';
import type { AppInfo } from './publish-engine.ts';
export type DefineKind = 'entity' | 'relationship' | 'event';
export interface IonOptions {
    app?: Partial<AppInfo>;
    generators?: string[];
}
export declare class Ion {
    #private;
    constructor(options?: IonOptions);
    define(kind: DefineKind, name: string, def: Record<string, unknown>): this;
    build(): Promise<UappSpec>;
    publish(uapp_spec: UappSpec): Promise<{
        file: string;
        content: string;
    }>;
}
