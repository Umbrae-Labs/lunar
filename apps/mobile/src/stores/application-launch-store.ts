import { create } from 'zustand';

interface ApplicationLaunchState {
  readonly initialContentReady: boolean;
  markInitialContentReady(): void;
}

export const useApplicationLaunchStore = create<ApplicationLaunchState>()((set) => ({
  initialContentReady: false,
  markInitialContentReady: () => set({ initialContentReady: true }),
}));
