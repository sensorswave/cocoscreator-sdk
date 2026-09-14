import { SafeStorage } from '../utils/safe-storage';
import type { ABData } from '../types';
export declare class Store {
    private _storage;
    private _commonProps;
    private _dynamicPropFns;
    constructor(storage: SafeStorage);
    getAnonId(): string;
    setLoginId(loginId: string): void;
    getLoginId(): string;
    clearLoginId(): void;
    resetAnonId(): void;
    clearABData(): void;
    registerCommonProperties(props: Record<string, any>): void;
    clearCommonProperties(keys?: string[]): void;
    getCommonProperties(): Record<string, any>;
    getABData(): ABData[];
    saveABData(results: ABData[]): void;
    setLaunched(): void;
    isLaunched(): boolean;
    getInstallTime(): number | null;
    setInstallTime(ts: number): void;
    setOptOut(optedOut: boolean): void;
    isOptedOut(): boolean;
}
