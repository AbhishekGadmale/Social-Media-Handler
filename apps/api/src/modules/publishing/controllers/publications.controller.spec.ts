import { PublicationsController } from './publications.controller';
import { ExecutionMetadataInterceptor } from '../../core/interceptors/execution-metadata.interceptor';
import { ValidationPipe } from '@nestjs/common';
import { AddPublicationTargetDto } from '../dto/publication.dto';

describe('PublicationsController Security & Interceptor', () => {
  let controller: PublicationsController;
  let interceptor: ExecutionMetadataInterceptor;

  const mockService = {
    addTarget: vi.fn().mockResolvedValue({
      id: 'variant-1',
      status: 'QUEUED',
      executionMetadata: { version: 1, operationId: 'internal' }
    }),
    updateTarget: vi.fn().mockResolvedValue({
      id: 'variant-1',
      status: 'QUEUED',
      executionMetadata: { version: 1, operationId: 'internal' }
    }),
  } as any;

  beforeEach(() => {
    controller = new PublicationsController(mockService);
    interceptor = new ExecutionMetadataInterceptor();
  });

  it('rejects executionMetadata from AddPublicationTargetDto injection', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    
    const maliciousPayload = {
      socialAccountId: '33333333-3333-3333-3333-333333333333',
      content: 'Hello',
      executionMetadata: { version: 1, operationId: 'attacker-uuid' }
    };

    let error: any;
    try {
      await pipe.transform(maliciousPayload, { type: 'body', metatype: AddPublicationTargetDto });
    } catch (e) {
      error = e;
    }
    
    expect(error).toBeDefined();
    expect(error.response.message).toContain('property executionMetadata should not exist');
  });

  it('does not leak executionMetadata in controller response via interceptor', async () => {
    const res = await controller.addTarget('workspace-1', { id: 'user-1' } as any, 'post-1', { socialAccountId: '33333333-3333-3333-3333-333333333333' } as AddPublicationTargetDto);
    
    const { of } = await import('rxjs');
    const callHandler: any = { handle: () => of(res) };
    const intercepted: any = await new Promise((resolve) => interceptor.intercept({} as any, callHandler).subscribe(resolve));
    
    expect(intercepted.id).toBe('variant-1');
    expect(intercepted.status).toBe('QUEUED');
    expect(intercepted.executionMetadata).toBeUndefined(); // Stripped!
  });
});
