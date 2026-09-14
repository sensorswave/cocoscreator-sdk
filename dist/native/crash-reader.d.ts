import type { NativeCrashRecord } from '../types';
import type { SafeStorage } from '../utils/safe-storage';
export declare function readPendingCrashes(storage: SafeStorage | null): NativeCrashRecord[];
export declare function markCrashesReported(maxTimestamp: number, storage: SafeStorage | null): void;
