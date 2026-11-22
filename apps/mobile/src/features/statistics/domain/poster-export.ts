/** Sequential delivery keeps only one full-resolution bitmap in memory. Completed pages survive retries. */
export async function exportPosterPages(options: {
  pages: readonly number[];
  completed: Set<number>;
  cancelled: () => boolean;
  capture: (page: number) => Promise<string>;
  write: (base64: string, page: number) => Promise<string>;
  deliver: (uri: string) => Promise<void>;
  remove: (uri: string) => Promise<void>;
  onSaved: (completed: ReadonlySet<number>) => void;
}) {
  for (const page of options.pages) {
    if (options.cancelled()) break;
    const base64 = await options.capture(page);
    if (options.cancelled()) break;
    const uri = await options.write(base64, page + 1);
    try {
      if (options.cancelled()) break;
      await options.deliver(uri);
      options.completed.add(page);
      options.onSaved(options.completed);
    } finally {
      await options.remove(uri).catch(() => {});
    }
  }
}
