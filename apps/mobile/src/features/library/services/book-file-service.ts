export interface ManagedBookAsset {
  readonly path: string;
  readonly uri: string;
  readonly byteSize: number;
  readonly sha256?: string;
}

export interface ManagedBookFile {
  readonly bookId: string;
  readonly uri: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly sha256: string;
  /** Extracted EPUB entries stored beside the managed book. */
  readonly assets?: readonly ManagedBookAsset[];
}

export interface ManagedBookCover {
  readonly bytes: Uint8Array;
  readonly fileExtension: string;
}

export type BookImportProgressHandler = (progress: number) => void;

export interface BookFileService {
  importEpub(sourceUri: string, fileName: string, onProgress?: BookImportProgressHandler): Promise<ManagedBookFile>;
  readBook(book: ManagedBookFile): Promise<ArrayBuffer>;
  saveCover(book: ManagedBookFile, cover: ManagedBookCover): Promise<string>;
  removeBook(book: ManagedBookFile): Promise<void>;
}
