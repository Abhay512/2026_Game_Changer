import { create } from "zustand";

/** Per-metric explainer tips. Shown by default; "Don't show again" is remembered in this browser.
 *  The (i) button always toggles a tip open or closed for the current visit. */
const KEY = "sa.hints.v1";

function load(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}

function save(dismissed: Record<string, true>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(dismissed));
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

interface HintState {
  dismissed: Record<string, true>;
  open: Record<string, boolean>; // explicit open/closed for this visit
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  setDismissed: (id: string, value: boolean) => void;
  hideAll: (ids: string[]) => void;
  resetAll: () => void;
}

export const useHints = create<HintState>((set, get) => ({
  dismissed: load(),
  open: {},
  isOpen: (id) => get().open[id] ?? !get().dismissed[id],
  toggle: (id) => set((s) => ({ open: { ...s.open, [id]: !get().isOpen(id) } })),
  setDismissed: (id, value) =>
    set((s) => {
      const dismissed = { ...s.dismissed };
      if (value) dismissed[id] = true;
      else delete dismissed[id];
      save(dismissed);
      return { dismissed, open: { ...s.open, [id]: !value } };
    }),
  hideAll: (ids) =>
    set((s) => {
      const dismissed = { ...s.dismissed };
      ids.forEach((id) => (dismissed[id] = true));
      save(dismissed);
      return { dismissed, open: {} };
    }),
  resetAll: () => {
    save({});
    set({ dismissed: {}, open: {} });
  },
}));
