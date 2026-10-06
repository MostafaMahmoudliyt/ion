type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;
export declare function validateMetadata(def: Obj, add: Add): void;
export {};
