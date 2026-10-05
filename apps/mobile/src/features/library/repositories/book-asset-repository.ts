import type { ManagedBookAsset } from '../services/book-file-service';

export interface BookAssetRecord extends ManagedBookAsset {
  readonly bookId: string;
}

export interface BookAssetRepository {
  saveMany(bookId: string, assets: readonly ManagedBookAsset[]): Promise<void>;
  listByBookId(bookId: string): Promise<readonly BookAssetRecord[]>;
  removeByBookId(bookId: string): Promise<void>;
}
