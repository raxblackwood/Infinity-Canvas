import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface ObjectStore {
  put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  has(key: string): Promise<boolean>;
  getUrl(key: string): string;
}

export class MemoryObjectStore implements ObjectStore {
  private objects: Map<string, { data: Uint8Array; contentType: string }> = new Map();

  async put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { data: new Uint8Array(data), contentType });
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    return item;
  }

  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  getUrl(key: string): string {
    return `/snapshot/${key}`;
  }
}

export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(config: {
    endpoint?: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrl?: string;
    region?: string;
  }) {
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

  async put(key: string, data: Uint8Array | Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );
  }

  async get(key: string): Promise<{ data: Uint8Array; contentType: string } | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return {
        data: bytes,
        contentType: response.ContentType || 'application/octet-stream',
      };
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    const res = await this.get(key);
    return res !== null;
  }

  getUrl(key: string): string {
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
    }
    return `/snapshot/${key}`;
  }
}

// Global default singleton for the process
let globalObjectStore: ObjectStore | null = null;

export function getObjectStore(): ObjectStore {
  if (globalObjectStore) return globalObjectStore;

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
  } else {
    globalObjectStore = new MemoryObjectStore();
  }

  return globalObjectStore;
}

export function setObjectStore(store: ObjectStore): void {
  globalObjectStore = store;
}
