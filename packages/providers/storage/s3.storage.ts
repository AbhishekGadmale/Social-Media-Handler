import { S3Client, HeadObjectCommand, DeleteObjectCommand, PutObjectCommand, GetObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { IObjectStorage, ObjectMetadata, UploadAuthorization } from './interfaces/IObjectStorage';
import { IMediaContentSource, MediaStreamOptions } from '../core/interfaces/IMediaContentSource';

export interface S3StorageOptions {
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export class S3ObjectStorage implements IObjectStorage, IMediaContentSource {
  private client: S3Client;
  private publicClient: S3Client;
  private bucket: string;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    
    const clientConfig: any = {
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    };

    if (options.endpoint) {
      clientConfig.endpoint = options.endpoint;
    }
    if (options.forcePathStyle !== undefined) {
      clientConfig.forcePathStyle = options.forcePathStyle;
    }

    this.client = new S3Client(clientConfig);

    const publicClientConfig = { ...clientConfig };
    if (options.publicEndpoint) {
      publicClientConfig.endpoint = options.publicEndpoint;
    }
    this.publicClient = new S3Client(publicClientConfig);
  }

  async createUpload(storageKey: string, mimeType: string, ttlSeconds: number = 900): Promise<UploadAuthorization> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.publicClient, command, { expiresIn: ttlSeconds });
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    return {
      uploadUrl,
      storageKey,
      expiresAt,
    };
  }

  async headObject(storageKey: string): Promise<ObjectMetadata> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });

      const response = await this.client.send(command);

      return {
        key: storageKey,
        byteSize: response.ContentLength || 0,
        mimeType: response.ContentType,
        exists: true,
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return {
          key: storageKey,
          byteSize: 0,
          exists: false,
        };
      }
      throw error;
    }
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: encodeURI(`${this.bucket}/${sourceKey}`),
      Key: destinationKey,
    });
    await this.client.send(command);
  }

  async deleteObject(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.client.send(command);
  }

  async getStream(storageKey: string, options?: MediaStreamOptions): Promise<Readable> {
    let range: string | undefined;
    if (options && (options.start !== undefined || options.end !== undefined)) {
      const start = options.start !== undefined ? options.start : '';
      const end = options.end !== undefined ? options.end : '';
      range = `bytes=${start}-${end}`;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Range: range,
    });

    const response = await this.client.send(command);
    
    if (!response.Body) {
      throw new Error(`Empty body returned for storageKey: ${storageKey}`);
    }

    // response.Body is a Node.js Readable in Node.js environments (SdkStream<Readable>)
    return response.Body as Readable;
  }
}
