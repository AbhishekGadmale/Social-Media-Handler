export class ApiError extends Error {
  public headers: Record<string, string>;
  constructor(
    public status: number,
    public data: unknown,
    message: string,
    headers?: Headers
  ) {
    super(message);
    this.name = 'ApiError';
    this.headers = {};
    if (headers) {
      headers.forEach((value, key) => {
        this.headers[key.toLowerCase()] = value;
      });
    }
  }
}

const getCookie = (name: string): string | undefined => {
  if (typeof document === 'undefined') return undefined;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift();
  return undefined;
};

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

export const apiClient = async <T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> => {
  const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
  
  // Clean up endpoint to ensure it doesn't start with / if baseURL ends with /
  const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const url = new URL(`${baseURL}/${path}`);

  if (options.params) {
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const reqHeaders = new Headers(options.headers);
  
  // Default headers
  if (!reqHeaders.has('Content-Type') && options.body && typeof options.body === 'string') {
    reqHeaders.set('Content-Type', 'application/json');
  }
  reqHeaders.set('Accept', 'application/json');

  // CSRF handling
  const method = options.method?.toUpperCase() || 'GET';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCookie('csrfToken');
    if (csrfToken) {
      reqHeaders.set('x-csrf-token', csrfToken);
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...options,
      headers: reqHeaders,
      credentials: 'include', // Important for session cookies
    });
  } catch (error) {
    // Network or fetch error
    throw new ApiError(
      0,
      null,
      error instanceof Error ? error.message : 'Network error'
    );
  }

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }
    throw new ApiError(
      response.status,
      errorData,
      (errorData as Record<string, unknown>)?.message as string || response.statusText || 'API Error',
      response.headers
    );
  }

  // Handle empty responses (e.g., 204 No Content)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return {} as T;
  }

  return response.json();
};

export const api = {
  get: <T>(endpoint: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<T>(endpoint, { ...options, method: 'GET' }),
  
  post: <T>(endpoint: string, data?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),
    
  put: <T>(endpoint: string, data?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),
    
  patch: <T>(endpoint: string, data?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),
    
  delete: <T>(endpoint: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
    apiClient<T>(endpoint, { ...options, method: 'DELETE' }),
};
