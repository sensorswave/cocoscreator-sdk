export declare class EventEmitter {
    private _listeners;
    on(event: string, listener: (...args: any[]) => void): void;
    off(event: string, listener: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
    once(event: string, listener: (...args: any[]) => void): void;
    removeAllListeners(event?: string): void;
}
