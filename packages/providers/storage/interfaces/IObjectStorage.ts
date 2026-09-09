import { Readable } from 'stream';

export interface ObjectMetadata {
  key: string;
  byteSize: number;
  mimeType?: string;
  exists: boolean;
}

export interface UploadAuthorization {
  uploadUrl: string;
  storageKey: string;
  expiresAt: Date;
}

export interface IObjectStorage {
  createUpload(storageKey: string, mimeType: string, ttlSeconds: number): Promise<UploadAuthorization>;
  headObject(storageKey: string): Promise<ObjectMetadata>;
  copyObject(sourceKey: string, destinationKey: string): Promise<void>;
  deleteObject(storageKey: string): Promise<void>;
}
