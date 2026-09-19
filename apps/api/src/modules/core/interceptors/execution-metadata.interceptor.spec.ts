import { ExecutionMetadataInterceptor } from './execution-metadata.interceptor';
import { of } from 'rxjs';

class CustomClass {
  constructor(public executionMetadata: any) {}
}

describe('ExecutionMetadataInterceptor', () => {
  let interceptor: ExecutionMetadataInterceptor;

  beforeEach(() => {
    interceptor = new ExecutionMetadataInterceptor();
  });

  const runInterceptor = (data: any) => {
    return new Promise<any>((resolve, reject) => {
      const callHandler: any = { handle: () => of(data) };
      interceptor.intercept({} as any, callHandler).subscribe({
        next: resolve,
        error: reject,
      });
    });
  };

  it('strips executionMetadata from a flat object', async () => {
    const data = { id: '1', executionMetadata: { version: 1 } };
    const result = await runInterceptor(data);
    expect(result.id).toBe('1');
    expect(result.executionMetadata).toBeUndefined();
  });

  it('strips executionMetadata from an array of objects', async () => {
    const data = [
      { id: '1', executionMetadata: { version: 1 } },
      { id: '2', executionMetadata: { version: 1 } },
    ];
    const result = await runInterceptor(data);
    expect(result).toHaveLength(2);
    expect(result[0].executionMetadata).toBeUndefined();
    expect(result[1].executionMetadata).toBeUndefined();
  });

  it('strips executionMetadata recursively', async () => {
    const data = {
      variants: [{ executionMetadata: { version: 1 } }],
      nested: { executionMetadata: { version: 1 } },
    };
    const result = await runInterceptor(data);
    expect(result.variants[0].executionMetadata).toBeUndefined();
    expect(result.nested.executionMetadata).toBeUndefined();
  });

  it('ignores nulls and undefineds', async () => {
    expect(await runInterceptor(null)).toBeNull();
    expect(await runInterceptor(undefined)).toBeUndefined();
  });

  it('does not mutate Date or Buffer objects', async () => {
    const date = new Date();
    const buffer = Buffer.from('test');
    const data = { date, buffer, executionMetadata: {} };
    const result = await runInterceptor(data);

    expect(result.date).toBeInstanceOf(Date);
    expect(result.date.getTime()).toBe(date.getTime());
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.executionMetadata).toBeUndefined();
  });

  it('does not strip executionMetadata from class instances (non-plain objects)', async () => {
    const instance = new CustomClass({ version: 1 });
    const result = await runInterceptor(instance);
    expect(result).toBeInstanceOf(CustomClass);
    expect(result.executionMetadata).toBeDefined();
    expect(result.executionMetadata.version).toBe(1);
  });

  it('does not mutate the original object', async () => {
    const data = { id: '1', executionMetadata: { version: 1 } };
    const result = await runInterceptor(data);
    expect(result.executionMetadata).toBeUndefined();
    expect(data.executionMetadata).toBeDefined();
  });
});
