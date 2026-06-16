import { PersistentQueue } from './persistent-queue';
import type { RequestConfig } from '../types';
export declare class BatchSender {
    private _queue;
    private _maxBatchSize;
    private _flushInterval;
    private _flushTimer;
    private _isFlushing;
    private _requestFn;
    private _destroyed;
    constructor(queue: PersistentQueue, requestFn: (config: RequestConfig) => void, maxBatchSize?: number, flushInterval?: number);
    start(): void;
    add(): void;
    triggerFlush(): void;
    flush(): void;
    flushImmediate(): void;
    private _doFlush;
    private _getSendableItems;
    private _startFlushTimer;
    private _clearFlushTimer;
    destroy(): void;
}
