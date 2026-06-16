export type EngineMajorVersion = 2 | 3;
export interface IEngineAdapter {
    readonly version: EngineMajorVersion;
    getPlatformEnum(): Record<string, number> | null;
    safeURLSearchParams(query: string): Record<string, string>;
    safeUUID(): string;
}
