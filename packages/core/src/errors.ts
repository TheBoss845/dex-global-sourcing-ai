export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

export const ErrorCodes = {
  ValidationError: 'VALIDATION_ERROR',
  ExtractionError: 'EXTRACTION_ERROR',
  SourceUnavailable: 'SOURCE_UNAVAILABLE',
  BudgetExceeded: 'BUDGET_EXCEEDED',
  BannedDomain: 'BANNED_DOMAIN',
  SsrfBlocked: 'SSRF_BLOCKED',
  NotFound: 'NOT_FOUND',
  Cancelled: 'CANCELLED',
} as const;
