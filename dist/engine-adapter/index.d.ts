import type { IEngineAdapter } from './types';
export declare function getEngineAdapter(): IEngineAdapter;
export declare function __resetEngineAdapterForTest(): void;
export type { IEngineAdapter, EngineMajorVersion } from './types';
export { detectEngineVersion } from './detector';
export { parseQuerySafe, generateUuidSafe } from './fallbacks';
export { createV2Adapter } from './v2';
export { createV3Adapter } from './v3';
