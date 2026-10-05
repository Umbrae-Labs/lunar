export interface LibraryBookRecord {
  readonly id: string;
  readonly title: string;
  readonly author?: string;
  readonly language?: string;
  readonly epubIdentifier: string;
  readonly publisher?: string;
  readonly description?: string;
  readonly fileUri: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly sha256: string;
  readonly coverUri?: string;
  readonly metadataVersion: number;
  readonly addedAt: number;
  readonly lastOpenedAt?: number;
  readonly updatedAt: number;
  readonly readingProgress?: number;
}
