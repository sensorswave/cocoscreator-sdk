import type { ExceptionFrame } from '../types';
export declare function cleanFrameFile(file: string, origin?: string): string;
export declare function parseExceptionFrames(stack: unknown, pageOrigin?: string): ExceptionFrame[];
export declare function enrichIosFrames(frames: ExceptionFrame[], images: unknown): void;
