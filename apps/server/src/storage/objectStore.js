import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
export class MemoryObjectStore {
    objects = new Map();
    async put(key, data, contentType) {
        this.objects.set(key, { data: new Uint8Array(data), contentType });
    }
    async get(key) {
        const item = this.objects.get(key);
        if (!item)
            return null;
        return item;
    }
    async has(key) {
        return this.objects.has(key);
    }
    getUrl(key) {
        return `/snapshot/${key}`;
    }
}
export class S3ObjectStore {
    client;
    bucket;
    publicUrl;
    constructor(config) {
        this.bucket = config.bucket;
        this.publicUrl = config.publicUrl || '';
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region || 'auto',
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: true,
        });
    }
    async put(key, data, contentType) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable',
        }));
    }
    async get(key) {
        try {
            const response = await this.client.send(new GetObjectCommand({
                Bucket: this.bucket,
                Key: key,
            }));
            if (!response.Body)
                return null;
            const bytes = await response.Body.transformToByteArray();
            return {
                data: bytes,
                contentType: response.ContentType || 'application/octet-stream',
            };
        }
        catch (err) {
            if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
                return null;
            }
            throw err;
        }
    }
    async has(key) {
        const res = await this.get(key);
        return res !== null;
    }
    getUrl(key) {
        if (this.publicUrl) {
            return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
        }
        return `/snapshot/${key}`;
    }
}
// Global default singleton for the process
let globalObjectStore = null;
export function getObjectStore() {
    if (globalObjectStore)
        return globalObjectStore;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    if (bucket && accessKeyId && secretAccessKey) {
        globalObjectStore = new S3ObjectStore({
            endpoint: process.env.S3_ENDPOINT,
            bucket,
            accessKeyId,
            secretAccessKey,
            publicUrl: process.env.S3_PUBLIC_URL,
            region: process.env.S3_REGION || 'us-east-1',
        });
    }
    else {
        globalObjectStore = new MemoryObjectStore();
    }
    return globalObjectStore;
}
export function setObjectStore(store) {
    globalObjectStore = store;
}
