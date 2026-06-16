import type { IPlugin, ABData, RequestConfig, SensorswaveSendEvent } from '../types';
import { Store } from '../basic/store';
import { Send } from '../basic/send';
import { PresetProperties } from '../basic/preset-props';
export declare enum ABType {
    FEATURE_GATE = 1,
    FEATURE_CONFIG = 2,
    EXPERIMENT = 3
}
export declare function getABPropKey(data: ABData): string;
export declare function buildABEventProps(data: ABData): Record<string, any>;
export interface ABTestOpts {
    store: Store;
    send: Send;
    presetProps: PresetProperties;
    enableAB: boolean;
    apiHost: string;
    sourceToken: string;
    refreshInterval: number;
    requestFn: (config: RequestConfig) => void;
    enqueueEvent: (event: SensorswaveSendEvent) => void;
}
export declare class ABTestPlugin implements IPlugin {
    static NAME: string;
    NAME: string;
    private _store;
    private _send;
    private _enableAB;
    private _apiHost;
    private _sourceToken;
    private _refreshInterval;
    private _requestFn;
    private _fetchingPromise;
    private _refreshTimer;
    private _enqueueEvent;
    private _lastFetchTime;
    constructor(opts: ABTestOpts);
    init(): void;
    private _startRefreshTimer;
    fastFetch(): Promise<ABData[]>;
    private _fetchFromServer;
    checkFeatureGate(key: string): Promise<boolean>;
    getFeatureConfig(key: string): Promise<Record<string, any>>;
    getExperiment(key: string): Promise<Record<string, any> | null>;
    private _trackFeatureImpress;
    private _trackExpImpress;
    destroy(): void;
}
