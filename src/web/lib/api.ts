export class ApiError extends Error {
  status: number;
  code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  idempotencyKey?: string;
};

/**
 * Thin fetch wrapper for the browser-owner (cookie-session) surface of the
 * gateway. Always sends credentials, JSON-encodes bodies, and normalizes the
 * server's `{ error, message }` envelope into a typed ApiError.
 */
export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...rest } = options;
  const init: RequestInit = {
    ...rest,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      ...headers,
    },
  };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('Network error — the gateway is unreachable.', 0);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const record = (payload && typeof payload === 'object' ? payload : {}) as {
      message?: string;
      error?: string;
    };
    throw new ApiError(
      record.message ?? (typeof payload === 'string' && payload ? payload : `Request failed (${response.status})`),
      response.status,
      record.error,
    );
  }

  return payload as T;
}
