import type { Issue } from './validate.ts';
import type { SpecSet } from './specs.ts';
type Obj = Record<string, any>;
type Add = (message: string, path?: string) => void;
type Engine = 'schema' | 'relationship' | 'event' | 'ui';
export interface Rule {
    id: string;
    engine: Engine;
    title: string;
    origin: 'existing' | 'added';
    check(set: Obj, add: Add): void;
}
export declare const RULES: Rule[];
export declare function checkRules(set: SpecSet): Issue[];
export {};
