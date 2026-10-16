"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "desmo-theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const CHANGE_EVENT = "desmo-theme-change";
const SERVER_SNAPSHOT = "light:light";
let memoryPreference: ThemePreference | null = null;

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): ThemePreference {
  if (memoryPreference) return memoryPreference;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  return theme === "system"
    ? window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light"
    : theme;
}

function snapshot(): string {
  const preference = storedTheme();
  return `${preference}:${resolveTheme(preference)}`;
}

function applyCurrentTheme() {
  document.documentElement.dataset.theme = resolveTheme(storedTheme());
}

function subscribe(onStoreChange: () => void) {
  const media = window.matchMedia(MEDIA_QUERY);
  const onChange = () => {
    applyCurrentTheme();
    onStoreChange();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    memoryPreference = null;
    onChange();
  };
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function setTheme(next: ThemePreference) {
  memoryPreference = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing may disable storage; the current page still updates.
  }
  applyCurrentTheme();
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  // The server snapshot also powers the first hydration render. RootLayout's
  // inline script sets the actual colors before paint; the store then updates
  // controls and any theme-aware browser widgets without a hydration mismatch.
  const value = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  const [theme, resolvedTheme] = value.split(":") as [ThemePreference, ResolvedTheme];

  useEffect(() => {
    applyCurrentTheme();
  }, []);

  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
