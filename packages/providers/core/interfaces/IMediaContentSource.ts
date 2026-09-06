import { Readable } from 'stream';

export interface MediaStreamOptions {
  start?: number;
  end?: number;
}

export interface IMediaContentSource {
  getStream(storageKey: string, options?: MediaStreamOptions): Promise<Readable>;
}
