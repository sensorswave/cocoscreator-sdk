export interface IStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
export declare class SafeStorage {
    private _storage;
    private _fallback;
    private _degraded;
    constructor(storage: IStorage);
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    get isDegraded(): boolean;
}
