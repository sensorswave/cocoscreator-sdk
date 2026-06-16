import type { IPlatformAdapter } from '../platform/interface';
export declare class PresetProperties {
    private _adapter;
    private _cache;
    private _cacheTimestamp;
    constructor(adapter: IPlatformAdapter);
    get(): Record<string, any>;
    invalidateCache(): void;
}
