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
    private _paused;
    private _started;
    constructor(queue: PersistentQueue, requestFn: (config: RequestConfig) => void, maxBatchSize?: number, flushInterval?: number);
    start(): void;
    pause(): void;
    resume(): void;
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
