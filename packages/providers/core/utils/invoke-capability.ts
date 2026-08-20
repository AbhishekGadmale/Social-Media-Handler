import { ISocialProvider } from '../interfaces/ISocialProvider';
import { ProviderCapabilityError } from '../errors';

/**
 * Safely invokes an optional capability method on a social provider.
 * Throws a typed ProviderCapabilityError if the method is not implemented.
 */
export async function invokeCapability<
  MethodName extends keyof ISocialProvider,
  MethodType extends ISocialProvider[MethodName]
>(
  provider: ISocialProvider,
  methodName: MethodName,
  ...args: MethodType extends (...args: any[]) => any ? Parameters<MethodType> : never
): Promise<MethodType extends (...args: any[]) => any ? Awaited<ReturnType<MethodType>> : never> {
  const method = provider[methodName];

  if (typeof method !== 'function') {
    throw new ProviderCapabilityError(String(methodName));
  }

  // We need to bind the method to the provider instance, 
  // since the method might use 'this' internally.
  return (method as Function).apply(provider, args);
}
