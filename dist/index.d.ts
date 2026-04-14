import { Plugin } from 'vite';

interface AutoChunkOptions {
    heavyThreshold?: number;
    warnThreshold?: number;
    extraVendors?: string[];
    summary?: boolean;
    suppressAnnotations?: boolean;
}
declare function autoChunk(options?: AutoChunkOptions): Plugin;

export { type AutoChunkOptions, autoChunk, autoChunk as default };
