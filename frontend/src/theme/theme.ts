import { create } from "zustand";

export type ThemeChoice = "light" | "dark";
const KEY = "sa.theme";

function systemTheme(): ThemeChoice {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function saved(): ThemeChoice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

interface ThemeState {
  theme: ThemeChoice;
  toggle: () => void;
}

/** Resolved theme. Explicit choice wins and is remembered; otherwise follows the OS. */
export const useTheme = create<ThemeState>((set, get) => ({
  theme: saved() ?? systemTheme(),
  toggle: () => {
    const next: ThemeChoice = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: still switch for this session */
    }
    set({ theme: next });
  },
}));

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (!saved()) useTheme.setState({ theme: systemTheme() });
});

/** Read the live token values (charts draw on canvas and need real colors). */
export function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    page: v("--page"),
    surface: v("--surface"),
    surface2: v("--surface-2"),
    ink1: v("--ink-1"),
    ink2: v("--ink-2"),
    ink3: v("--ink-3"),
    grid: v("--grid"),
    axis: v("--axis"),
    accent: v("--accent"),
    accentWash: v("--accent-wash"),
    up: v("--up"),
    down: v("--down"),
    upWash: v("--up-wash"),
    downWash: v("--down-wash"),
    vwap: v("--vwap"),
    base: v("--base"),
    fontSans: v("--font-sans"),
    fontMono: v("--font-mono"),
  };
}

export type Tokens = ReturnType<typeof tokens>;
