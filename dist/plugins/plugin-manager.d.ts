import { EventEmitter } from '../utils/event-emitter';
import type { IPlugin, IPluginConstructor } from '../types';
export declare class PluginManager {
    private _pluginClasses;
    private _pluginInsMap;
    private _emitter;
    constructor(emitter: EventEmitter);
    register(pluginClass: IPluginConstructor): void;
    created(opts: any): void;
    initAll(): void;
    getPlugin<T extends IPlugin>(name: string): T | undefined;
    getAllPlugins(): Map<string, IPlugin>;
    destroy(): void;
}
