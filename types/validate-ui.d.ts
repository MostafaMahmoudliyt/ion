type Add = (code: string, path: string, message: string) => void;
type Obj = Record<string, unknown>;
export declare function validateI18n(def: Obj, add: Add): void;
export {};
