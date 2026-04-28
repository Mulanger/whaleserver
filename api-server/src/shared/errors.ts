export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function mapError(e: unknown): { statusCode: number; message: string; code?: string } {
  if (e instanceof ApiError) {
    return { statusCode: e.statusCode, message: e.message, code: e.code };
  }
  if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'MongoServerError') {
    return { statusCode: 500, message: 'database error' };
  }
  return { statusCode: 500, message: 'internal server error' };
}

export function notFound(message = 'resource not found'): ApiError {
  return new ApiError(404, message, 'NOT_FOUND');
}

export function badRequest(message = 'bad request'): ApiError {
  return new ApiError(400, message, 'BAD_REQUEST');
}

export function unauthorized(message = 'unauthorized'): ApiError {
  return new ApiError(401, message, 'UNAUTHORIZED');
}

export function forbidden(message = 'forbidden'): ApiError {
  return new ApiError(403, message, 'FORBIDDEN');
}