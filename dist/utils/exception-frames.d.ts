import type { ExceptionFrame, ExceptionConfig } from '../types';
export declare function cleanFrameFile(file: string, origin?: string): string;
export declare function parseExceptionFrames(stack: unknown, pageOrigin?: string): ExceptionFrame[];
export declare function enrichIosFrames(frames: ExceptionFrame[], images: unknown): void;
export declare function markInAppFrames(frames: ExceptionFrame[], exceptionConfig?: ExceptionConfig): void;
