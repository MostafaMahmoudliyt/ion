import type { Attribute } from './types.ts';
type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;
export declare function valueProblem(a: Attribute, v: unknown): string | undefined;
export declare function validateEvents(def: Obj, add: Add): void;
export {};
