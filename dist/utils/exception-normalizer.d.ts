import type { NormalizedException, NativeCrashRecord } from '../types';
export declare function normalizeException(input: unknown): NormalizedException;
export declare function normalizeOnErrorArgs(message: any, source: any, lineno: any, colno: any, error: any): NormalizedException;
export declare function normalizeRejectionReason(reason: unknown): NormalizedException;
export declare function normalizeCocosErrorHandler(...args: unknown[]): NormalizedException;
export declare function normalizeNativeCrash(record: unknown): NativeCrashRecord | null;
