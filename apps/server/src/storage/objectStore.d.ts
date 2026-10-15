export interface ObjectStore {
    put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    } | null>;
    has(key: string): Promise<boolean>;
    getUrl(key: string): string;
}
export declare class MemoryObjectStore implements ObjectStore {
    private objects;
    put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    } | null>;
    has(key: string): Promise<boolean>;
    getUrl(key: string): string;
}
export declare class S3ObjectStore implements ObjectStore {
    private client;
    private bucket;
    private publicUrl;
    constructor(config: {
        endpoint?: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        publicUrl?: string;
        region?: string;
    });
    put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void>;
    get(key: string): Promise<{
        data: Uint8Array;
        contentType: string;
    } | null>;
    has(key: string): Promise<boolean>;
    getUrl(key: string): string;
}
export declare function getObjectStore(): ObjectStore;
export declare function setObjectStore(store: ObjectStore): void;
