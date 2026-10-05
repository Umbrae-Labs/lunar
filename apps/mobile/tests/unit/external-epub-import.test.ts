import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createExternalImport,
  getExternalImport,
  redirectExternalEpub,
  releaseExternalImport,
} from '../../src/features/library/services/external-import-service';

const mocks = vi.hoisted(() => ({
  stage: vi.fn(),
  initialShares: vi.fn((): string[] => []),
  importFile: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../src/features/library/infrastructure/external-epub-receiver', () => ({
  stageExternalEpub: mocks.stage,
  takeInitialEpubShares: mocks.initialShares,
}));
vi.mock('../../src/features/library/services/library-service', () => ({ importEpubFile: mocks.importFile }));
vi.mock('expo-file-system', () => ({
  File: class {
    delete = mocks.remove;
  },
}));

function taskFor(route: string) {
  const id = new URL(route, 'https://lunar.test').searchParams.get('requestId')!;
  return { id, task: getExternalImport(id)! };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialShares.mockReturnValue([]);
  mocks.stage.mockImplementation(async (uri: string) => ({
    uri: `file:///cache/${encodeURIComponent(uri)}.epub`,
    fileName: 'book.epub',
  }));
  mocks.importFile.mockResolvedValue({ id: 'book', title: 'Book' });
});

describe('external EPUB import', () => {
  it('copies a content URI, imports once across repeated consumers, and cleans the cache', async () => {
    const { id, task } = taskFor(redirectExternalEpub({ path: 'content://provider/document/42', initial: true }));
    expect(getExternalImport(id)).toBe(task);
    await Promise.all([task, getExternalImport(id)]);
    expect(mocks.stage).toHaveBeenCalledWith('content://provider/document/42');
    expect(mocks.importFile).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    releaseExternalImport(id);
    expect(getExternalImport(id)).toBeUndefined();
  });

  it('continues a batch after an unreadable file and cleans files after parser failure', async () => {
    mocks.stage.mockRejectedValueOnce(new Error('Permission denied'));
    mocks.importFile.mockRejectedValueOnce(new Error('Invalid EPUB'));
    const { task } = taskFor(
      createExternalImport(['content://unreadable', 'content://invalid', 'content://valid', 'content://valid']),
    );
    const results = await task;
    expect(results).toHaveLength(3);
    expect(results[0].error).toBeInstanceOf(Error);
    expect(results[1].error).toBeInstanceOf(Error);
    expect(results[2].book?.id).toBe('book');
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('stages a second request immediately while serializing imports', async () => {
    let finish!: (book: { id: string }) => void;
    mocks.importFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = taskFor(createExternalImport(['file:///first.epub']));
    await vi.waitFor(() => expect(mocks.importFile).toHaveBeenCalledTimes(1));
    const second = taskFor(createExternalImport(['file:///second.epub']));
    expect(mocks.stage).toHaveBeenCalledTimes(2);
    expect(mocks.importFile).toHaveBeenCalledTimes(1);
    finish({ id: 'first' });
    await Promise.all([first.task, second.task]);
    expect(mocks.importFile).toHaveBeenCalledTimes(2);
  });

  it('handles cold-start shares before normal navigation and preserves ordinary links', async () => {
    mocks.initialShares.mockReturnValueOnce(['content://shared']);
    const { task } = taskFor(redirectExternalEpub({ path: '/', initial: true }));
    await task;
    expect(mocks.stage).toHaveBeenCalledWith('content://shared');
    expect(redirectExternalEpub({ path: 'lunar://reader/book', initial: false })).toBe('lunar://reader/book');
    expect(redirectExternalEpub({ path: '/settings', initial: false })).toBe('/settings');
  });
});
