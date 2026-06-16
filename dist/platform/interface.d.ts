import type { IPlatformAdapter, PlatformType } from '../types';
import { type GetDeviceInfoFn } from '../native/native-bridge';
export type { IPlatformAdapter } from '../types';
type MiniGameSDK = {
    getLaunchOptionsSync?: () => {
        path?: string;
        query?: Record<string, any>;
        scene?: string;
    } | null;
    getCurrentPages?: () => Array<{
        route?: string;
        options?: Record<string, any>;
    }>;
    onShareAppMessage?: (cb: (res: {
        from: string;
        webViewUrl?: string;
    }) => void) => void;
    offShareAppMessage?: (cb?: (res: any) => void) => void;
    getSystemInfoSync?: () => Record<string, any>;
    getNetworkType?: (opts: {
        success?: (res: {
            networkType: string;
            errMsg?: string;
        }) => void;
        fail?: (err: any) => void;
        complete?: () => void;
    }) => void;
    onNetworkTypeChange?: (cb: (res: {
        networkType: string;
    }) => void) => void;
    offNetworkTypeChange?: (cb?: (res: {
        networkType: string;
    }) => void) => void;
    [k: string]: any;
};
export declare function getMPSDK(): MiniGameSDK | null;
export declare function safeCall<T = any>(sdk: MiniGameSDK | null, method: string): T | null;
export declare function detectPlatform(ccSys: any): PlatformType;
export declare function createPlatformAdapter(platformType: PlatformType, ccSys: any, getSceneName?: () => string, getDeviceInfo?: GetDeviceInfoFn): IPlatformAdapter;
