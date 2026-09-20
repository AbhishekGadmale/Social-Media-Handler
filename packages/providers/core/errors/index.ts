export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
    Object.setPrototypeOf(this, ProviderAuthError.prototype);
  }
}

export class ProviderRateLimitError extends Error {
  public readonly retryAfter?: number; // In seconds

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'ProviderRateLimitError';
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, ProviderRateLimitError.prototype);
  }
}

export class ProviderApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ProviderApiError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ProviderApiError.prototype);
  }
}

export class ProviderCapabilityError extends Error {
  constructor(capabilityName: string) {
    super(`Provider does not support capability: ${capabilityName}`);
    this.name = 'ProviderCapabilityError';
    Object.setPrototypeOf(this, ProviderCapabilityError.prototype);
  }
}


export class ProviderCoordinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderCoordinationError';
    Object.setPrototypeOf(this, ProviderCoordinationError.prototype);
  }
}
