export declare function makeResolver<T extends {
    id: string;
    name: string;
}>(entities: T[]): (ref: unknown) => T | undefined;
