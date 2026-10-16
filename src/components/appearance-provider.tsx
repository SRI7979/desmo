"use client";

import { createContext, useContext, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, appearanceTokens, parseAppearance, type AppearancePreferences } from "@/lib/appearance";
import { useTheme } from "./theme-provider";

type AppearanceContextValue = {
  preferences: AppearancePreferences;
  setPreferences: (next: AppearancePreferences) => void;
  reset: () => void;
};
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function AppearanceProvider({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [preferences, update] = useState<AppearancePreferences>(() => {
    if (typeof window === "undefined") return DEFAULT_APPEARANCE;
    try { return parseAppearance(window.sessionStorage.getItem(APPEARANCE_STORAGE_KEY)); }
    catch { return DEFAULT_APPEARANCE; }
  });
  const setPreferences = (next: AppearancePreferences) => {
    const validated = parseAppearance(JSON.stringify(next));
    update(validated);
    try { window.sessionStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(validated)); }
    catch { /* The in-memory session still works when storage is unavailable. */ }
  };
  return <AppearanceContext.Provider value={{ preferences: mounted ? preferences : DEFAULT_APPEARANCE, setPreferences, reset: () => setPreferences(DEFAULT_APPEARANCE) }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}

/** Scoped styling only; never remount children on an appearance change. */
export function WorkspaceAppearance({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { preferences } = useAppearance();
  const { resolvedTheme } = useTheme();
  // Both palettes are available during SSR. The pre-paint theme script chooses
  // the CSS aliases before hydration, so a saved Dark preference never flashes Light.
  const style = Object.fromEntries((["light", "dark"] as const).flatMap(mode =>
    Object.entries(appearanceTokens(preferences, mode === "dark")).map(([key, value]) => [`--appearance-${mode}-${key}`, value]),
  )) as CSSProperties;
  return <div className={`desmo-shell ${className}`} style={style} data-button={preferences.button.toLowerCase()} data-typography={preferences.text.toLowerCase()} data-color-mode={resolvedTheme}>{children}</div>;
}
