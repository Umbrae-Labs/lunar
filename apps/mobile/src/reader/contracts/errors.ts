export const READER_ERROR_CODES = {
  bookMissing: 'BOOK_MISSING',
  invalidEpub: 'INVALID_EPUB',
  resourceLimitExceeded: 'RESOURCE_LIMIT_EXCEEDED',
  fontRegistrationFailed: 'FONT_REGISTRATION_FAILED',
  imageDecodeFailed: 'IMAGE_DECODE_FAILED',
  paginationFailed: 'PAGINATION_FAILED',
  renderFailed: 'RENDER_FAILED',
  staleRevision: 'STALE_REVISION',
} as const;

export type ReaderErrorCode = (typeof READER_ERROR_CODES)[keyof typeof READER_ERROR_CODES];

export class LunarReaderError extends Error {
  readonly code: ReaderErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: ReaderErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'LunarReaderError';
    this.code = code;
    this.details = details;
  }
}
