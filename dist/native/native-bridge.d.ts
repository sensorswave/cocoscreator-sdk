export interface NativeDeviceInfo {
    deviceId?: string;
    appId?: string;
    appName?: string;
    appVersion?: string;
    manufacturer?: string;
    brand?: string;
    model?: string;
    osVersion?: string;
    region?: string;
}
export type GetDeviceInfoFn = (() => NativeDeviceInfo | Promise<NativeDeviceInfo>) | null | undefined;
export declare class NativeBridge {
    private _userFn;
    private _cache;
    private _inflight;
    private _sys;
    private _networkTypeCache;
    private _networkEventsSubscribed;
    private _networkPollTimer;
    private _networkPollCount;
    private static readonly NETWORK_POLL_MAX;
    private static readonly NETWORK_POLL_INTERVAL_MS;
    private _bridgeHealthCheckTimer;
    private static readonly BRIDGE_HEALTH_CHECK_DELAY_MS;
    constructor(sys: any);
    private _subscribeNetworkEvents;
    private _readNetworkType;
    private _tryReadNetworkTypeImmediately;
    private _scheduleNetworkPoll;
    dispose(): void;
    private _scheduleBridgeHealthCheck;
    setUserFn(fn: GetDeviceInfoFn): void;
    invalidateCache(): void;
    getDeviceInfoSync(): NativeDeviceInfo;
    getDeviceInfoAsync(): Promise<NativeDeviceInfo>;
    private _readFromSysAndAutoFill;
    private _readInjectedAppInfo;
    readNetworkType(): string;
    private _fetchWithFallback;
    private _mergeWithSysAndAutoFill;
    private _readFromSys;
    private _isUseful;
    private _readOrGenerateDeviceId;
    private _tryJsbAndroidStaticField;
}
