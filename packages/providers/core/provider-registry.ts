import { ISocialProvider } from './interfaces/ISocialProvider.js';
import { IPublishingProvider } from './interfaces/IPublishingProvider.js';
import { LinkedInProvider } from '../linkedin/linkedin.provider.js';
import { YouTubeProvider } from '../youtube/youtube.provider.js';
import { ProviderCapabilityError } from './errors/index.js';

type ProviderFactory = () => ISocialProvider;

export class ProviderRegistry {
  private factories: Map<string, ProviderFactory> = new Map();
  private instances: Map<string, ISocialProvider> = new Map();

  register(name: string, factory: ProviderFactory) {
    this.factories.set(name, factory);
  }

  get(name: string): ISocialProvider | undefined {
    if (this.instances.has(name)) {
      return this.instances.get(name);
    }

    const factory = this.factories.get(name);
    if (!factory) {
      return undefined;
    }

    const instance = factory();
    this.instances.set(name, instance);
    return instance;
  }

  getOrThrow(name: string): ISocialProvider {
    const provider = this.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found in registry.`);
    }
    return provider;
  }

  supportsPublishing(name: string): boolean {
    const provider = this.get(name);
    if (!provider) return false;
    // Structural type check for IPublishingProvider
    return 'getPublishingCapabilities' in provider && 'validateProviderOptions' in provider && 'publish' in provider;
  }

  getPublishingAdapter(name: string): IPublishingProvider {
    if (!this.supportsPublishing(name)) {
      throw new ProviderCapabilityError('PUBLISHING');
    }
    // Safe cast because of supportsPublishing structural check
    return this.get(name) as unknown as IPublishingProvider;
  }
}

export const providerRegistry = new ProviderRegistry();
providerRegistry.register('linkedin', () => new LinkedInProvider());
providerRegistry.register('youtube', () => new YouTubeProvider());


