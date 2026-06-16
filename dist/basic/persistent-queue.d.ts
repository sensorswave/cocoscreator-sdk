import { SafeStorage } from '../utils/safe-storage';
import type { QueueItem, SensorswaveSendEvent } from '../types';
export declare class PersistentQueue {
    private _storage;
    private _queue;
    private _loaded;
    constructor(storage: SafeStorage);
    private _load;
    private _filterExpired;
    private _enforceMaxSize;
    private _persist;
    enqueue(events: SensorswaveSendEvent[], url: string, headers: Record<string, string>): string;
    dequeue(ids: string[]): void;
    getAll(): QueueItem[];
    peek(count: number): QueueItem[];
    get size(): number;
    incrementRetryCount(id: string): void;
    markDead(id: string): void;
}
