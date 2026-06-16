import type { NativeDeviceInfo } from './native/native-bridge';
export interface SensorswaveConfig {
    sourceToken?: string;
    apiHost: string;
    debug?: boolean;
    autoCapture?: boolean;
    batchSend?: boolean;
    maxBatchSize?: number;
    flushInterval?: number;
    enableAB?: boolean;
    abRefreshInterval?: number;
    enableShareTrack?: boolean;
    getSceneName?: () => string;
    getDeviceInfo?: () => NativeDeviceInfo | Promise<NativeDeviceInfo>;
}
export type RequiredConfig = Required<Omit<SensorswaveConfig, 'sourceToken' | 'apiHost' | 'getSceneName' | 'getDeviceInfo'>>;
export interface SensorswaveSendEvent {
    event: string;
    time: number;
    trace_id: string;
    anon_id?: string;
    login_id?: string;
    properties?: Record<string, any>;
    user_properties?: Record<string, any>;
    subject_properties?: Record<string, any>;
}
export interface SensorswaveEvent {
    event: string;
    properties: Record<string, any>;
    user_properties?: Record<string, any>;
}
export interface IdentifyEventData {
    event: '$Identify';
    time: number;
    trace_id: string;
    anon_id: string;
    login_id: string;
    properties?: Record<string, any>;
}
export interface UserProperties {
    $set?: Record<string, any>;
    $set_once?: Record<string, any>;
    $increment?: Record<string, number>;
    $append?: Record<string, any[]>;
    $union?: Record<string, any[]>;
    $unset?: Record<string, null>;
    $delete?: true;
}
export interface ProfileEventData {
    event: '$UserSet';
    time: number;
    trace_id: string;
    anon_id: string;
    login_id?: string;
    properties: Record<string, any>;
    user_properties: UserProperties;
}
export interface QueueItem {
    id: string;
    url: string;
    data: SensorswaveSendEvent[];
    headers: Record<string, string>;
    timestamp: number;
    retryCount: number;
    dead: boolean;
}
export interface ABData {
    id: number;
    key: string;
    typ: number;
    vid?: string;
    value?: Record<string, any>;
    disable_impress?: boolean;
}
export interface ABCacheData {
    results: ABData[];
    timestamp: number;
    anon_id: string;
    login_id?: string;
}
export interface SensorswaveABRequestData {
    user: {
        anon_id?: string;
        login_id?: string;
        props?: Record<string, any>;
    };
    sdk: string;
    sdk_version: string;
}
export interface HttpResponse {
    statusCode: number;
    text?: string;
    json?: any;
}
export type ResponseCallback = (response: HttpResponse) => void;
export interface RequestConfig {
    url: string;
    method?: 'POST' | 'GET';
    data?: any;
    headers?: Record<string, string>;
    callback?: ResponseCallback;
    timeout?: number;
}
export interface TrackResponse {
    code: number;
    msg: string;
}
export interface ABResponse {
    code: number;
    msg: string;
    data?: {
        results: ABData[];
    };
}
export type PlatformType = 'app' | 'minigame' | 'h5';
export interface IPlatformAdapter {
    getPlatformType(): PlatformType;
    getPresetProperties(): Record<string, any>;
    getDynamicProperties(): Record<string, any>;
    getLaunchOptions(): Record<string, any>;
}
export interface IPlugin {
    NAME: string;
    init(): void;
    destroy(): void;
}
export interface IPluginConstructor {
    new (opts: any): IPlugin;
    NAME: string;
}
