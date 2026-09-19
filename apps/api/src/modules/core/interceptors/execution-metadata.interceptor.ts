import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ExecutionMetadataInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => this.stripMetadata(data)));
  }

  private isPlainObject(value: any): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
  }

  private stripMetadata(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.stripMetadata(item));
    }

    if (this.isPlainObject(data)) {
      const copy = { ...data };
      if ('executionMetadata' in copy) {
        delete copy.executionMetadata;
      }

      for (const key of Object.keys(copy)) {
        copy[key] = this.stripMetadata(copy[key]);
      }
      return copy;
    }

    return data;
  }
}
