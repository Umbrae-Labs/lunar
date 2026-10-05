interface ProgressNavigationState {
  readonly draftPage?: number;
  readonly isNavigating: boolean;
}

/** Holds the requested position until both navigation and the displayed snapshot agree. */
export function createProgressNavigationController(
  navigate: (page: number) => Promise<number | undefined>,
  onFailure: () => void,
) {
  let state: ProgressNavigationState = { isNavigating: false };
  let currentPage: number | undefined;
  let queuedPage: number | undefined;
  let settled = false;
  let disposed = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function publish(next: ProgressNavigationState) {
    if (disposed) return;
    state = next;
    listeners.forEach((listener) => listener());
  }

  function acknowledge() {
    if (settled && currentPage === state.draftPage) {
      settled = false;
      publish({ isNavigating: false });
    }
  }

  function beginDrag() {
    if (disposed || state.isNavigating) return;
    clearTimeout(timer);
    queuedPage = undefined;
  }

  function preview(page: number) {
    if (disposed || state.isNavigating) return;
    beginDrag();
    publish({ draftPage: page, isNavigating: false });
  }

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || state.isNavigating || queuedPage === undefined) return;
    const target = queuedPage;
    queuedPage = undefined;
    if (target === currentPage) {
      publish({ isNavigating: false });
      return;
    }
    settled = false;
    const operationGeneration = generation;
    publish({ draftPage: target, isNavigating: true });
    void (async () => {
      try {
        const actualPage = await navigate(target);
        if (disposed || generation !== operationGeneration) return;
        settled = true;
        publish({ draftPage: actualPage ?? target, isNavigating: true });
        acknowledge();
      } catch {
        if (disposed || generation !== operationGeneration) return;
        publish({ isNavigating: false });
        onFailure();
      }
    })();
  }

  return {
    getSnapshot: () => state,
    activate() {
      disposed = false;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    observe(page: number | undefined) {
      currentPage = page;
      acknowledge();
    },
    preview,
    beginDrag,
    cancelDrag() {
      if (!state.isNavigating) publish({ isNavigating: false });
    },
    request(page: number) {
      if (disposed || state.isNavigating) return;
      preview(page);
      queuedPage = page;
      timer = setTimeout(flush, 250);
    },
    dismiss() {
      flush();
      if (!state.isNavigating) publish({ isNavigating: false });
    },
    dispose() {
      disposed = true;
      generation++;
      clearTimeout(timer);
      queuedPage = undefined;
      settled = false;
      state = { isNavigating: false };
      listeners.clear();
    },
  };
}
