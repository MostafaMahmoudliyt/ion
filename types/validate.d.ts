import { makeResolver } from './resolve.ts';
export { makeResolver };
export interface Issue {
    code: string;
    path: string;
    message: string;
}
export declare class IonValidationError extends Error {
    issues: Issue[];
    constructor(issues: Issue[]);
}
export declare function validateDefinition(def: unknown): Issue[];
