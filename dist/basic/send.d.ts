import { Store } from './store';
import { PresetProperties } from './preset-props';
import type { SensorswaveSendEvent, UserProperties } from '../types';
export declare class Send {
    private _store;
    private _presetProps;
    private _utmProvider;
    constructor(store: Store, presetProps: PresetProperties);
    setUtmProvider(provider: () => Record<string, string>): void;
    sendEvent(eventName: string, properties?: Record<string, any>, userProperties?: UserProperties, subjectProperties?: Record<string, any>): SensorswaveSendEvent;
    buildEnrichedProperties(eventProps: Record<string, any>, utmProps: Record<string, string>): Record<string, any>;
    private _mergeUtmUserProperties;
    private _filterSensitiveFields;
    static isValidEventName(eventName: string): boolean;
}
