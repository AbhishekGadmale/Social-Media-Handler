import { Test, TestingModule } from '@nestjs/testing';
import { PublishingModule } from './publishing.module';
import { ProviderRegistry } from '@agency-os/providers';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '../logger.config';

describe('PublishingModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [LoggerModule.forRoot(loggerConfig), PublishingModule],
    }).compile();
  });

  afterEach(async () => {
    if (module) await module.close();
  });

  it('should resolve a populated ProviderRegistry', () => {
    const registry = module.get<ProviderRegistry>(ProviderRegistry);
    expect(registry).toBeDefined();

    // Verify it's the global populated registry
    expect(registry.supportsPublishing('LINKEDIN')).toBe(true);
    expect(registry.supportsPublishing('YOUTUBE')).toBe(true);
    expect(registry.supportsPublishing('linkedin')).toBe(true);

    const linkedin = registry.get('LINKEDIN');
    const linkedinLower = registry.get('linkedin');
    expect(linkedin).toBeDefined();
    expect(linkedin).toBe(linkedinLower); // Should resolve to same instance

    // Verify an unknown provider fails safely
    expect(registry.supportsPublishing('UNKNOWN_TEST')).toBe(false);
  });
});
