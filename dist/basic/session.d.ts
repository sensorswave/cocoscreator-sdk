import { SafeStorage } from '../utils/safe-storage';
export declare class SessionManager {
    private _storage;
    private _lastPersistedActivityTs;
    constructor(storage: SafeStorage);
    getSessionId(options?: {
        recordActivity?: boolean;
    }): string;
    reset(): void;
    private _read;
    private _write;
}
