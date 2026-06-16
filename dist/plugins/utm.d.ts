import type { IPlugin, SensorswaveSendEvent } from '../types';
import { Store } from '../basic/store';
import { Send } from '../basic/send';
import { PresetProperties } from '../basic/preset-props';
export interface UTMOpts {
    store: Store;
    send: Send;
    presetProps: PresetProperties;
    platformAdapter: any;
    enqueueEvent: (event: SensorswaveSendEvent) => void;
}
export declare class UTMPlugin implements IPlugin {
    static NAME: string;
    NAME: string;
    private _store;
    private _send;
    private _platformAdapter;
    private _currentUtm;
    private _enqueueEvent;
    private _destroyed;
    private _userSetTimer;
    constructor(opts: UTMOpts);
    init(): void;
    setDeepLinkQuery(query: Record<string, any> | string | null | undefined): void;
    private _extractUTM;
    private _parseUTMFromQuery;
    private _parseUTMFromURL;
    private _reportInitialUTM;
    getSessionUTM(): Record<string, string>;
    destroy(): void;
}
