export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function providerError(provider: string, status?: number): AppError {
  return new AppError(
    502,
    `${provider.toUpperCase()}_UNAVAILABLE`,
    `${provider} is temporarily unavailable`,
    status ? { status } : undefined,
  );
}
