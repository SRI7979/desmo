"use client";

import { useId, useRef, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, SlidersHorizontal, Sun, X } from "lucide-react";
import { PALETTES } from "@/lib/appearance";
import { useAppearance } from "./appearance-provider";
import { useTheme } from "./theme-provider";
import styles from "./appearance-studio.module.css";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

const PREFERENCE_GROUPS = [
  { key: "text", label: "Typography", options: ["Modern", "Editorial", "Technical"] },
  { key: "button", label: "Button treatment", options: ["Solid", "Outline", "Raised"] },
  { key: "corners", label: "Corner style", options: ["Crisp", "Soft", "Round"] },
] as const;

const noop = () => () => {};

export function AppearanceThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  return (
    <div role="radiogroup" aria-label="Theme" className={`${styles.themeToggle} flex items-center gap-0.5 rounded-full bg-muted p-0.5 ${className}`}>
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`${styles.themeOption} grid size-7 place-items-center rounded-full transition-all hover:text-foreground ${selected ? "bg-background text-foreground shadow-card" : "text-muted-foreground"}`}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

export function AppearanceStudio({ settings = false }: { settings?: boolean }) {
  const { preferences, setPreferences, reset } = useAppearance();
  const { setTheme } = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const instanceId = useId();
  const titleId = `${instanceId}-appearance-title`;
  const palette = PALETTES[preferences.palette];

  return (
    <>
      {settings ? (
        <button
          type="button"
          title="Customize appearance"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
          className={styles.settingsTrigger}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
          <span><strong>Customize appearance</strong><span>{palette.name} · {preferences.text} · {preferences.button} · {preferences.corners}</span></span>
        </button>
      ) : (
        <button
          type="button"
          title="Appearance settings"
          aria-label="Appearance settings"
          aria-haspopup="dialog"
          onClick={() => dialog.current?.showModal()}
          className={`${styles.iconTrigger} grid size-9 place-items-center rounded-xl border bg-card text-muted-foreground hover:text-foreground`}
        >
          <SlidersHorizontal className="size-4" aria-hidden="true" />
        </button>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className={`${styles.dialog} appearance-dialog m-auto max-h-[90dvh] w-[min(900px,94vw)] overflow-y-auto rounded-2xl border bg-background p-0 text-foreground shadow-pop backdrop:bg-black/50`}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b bg-background px-6 py-5">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">Settings / Appearance</p>
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">Make room for your style.</h2>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close appearance settings" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-muted">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="grid gap-8 p-6 md:grid-cols-[1fr_250px]">
          <div className="flex flex-col gap-7">
            <section>
              <h3 className="font-medium">Curated palettes</h3>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">Not just an accent. A whole atmosphere.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PALETTES.map((entry, index) => (
                  <button
                    key={entry.name}
                    type="button"
                    aria-pressed={preferences.palette === index}
                    onClick={() => setPreferences({ ...preferences, palette: index })}
                    className="rounded-xl border bg-card p-3 text-left transition-colors hover:border-brand"
                    style={{ outline: preferences.palette === index ? "2px solid var(--brand)" : undefined, outlineOffset: "2px" }}
                  >
                    <div className="mb-3 flex h-12 overflow-hidden rounded-lg" aria-hidden="true">
                      {entry.light.filter((_, colorIndex) => [0, 2, 4, 5].includes(colorIndex)).map((color) => <span key={color} className="flex-1" style={{ background: color }} />)}
                    </div>
                    <div className="flex items-center justify-between text-sm font-medium">
                      {entry.name}{preferences.palette === index && <Check className="size-4 text-brand" aria-hidden="true" />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
                  </button>
                ))}
              </div>
            </section>
            {PREFERENCE_GROUPS.map((group) => (
              <fieldset key={group.key}>
                <legend className="mb-3 text-sm font-medium">{group.label}</legend>
                <div className="flex flex-wrap gap-2">
                  {group.options.map((option) => (
                    <label key={option} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                      <input
                        className="accent-[var(--brand)]"
                        type="radio"
                        name={`${instanceId}-${group.key}`}
                        checked={preferences[group.key] === option}
                        onChange={() => setPreferences({ ...preferences, [group.key]: option })}
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <aside className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Live preview</span>
              <span className="size-2 rounded-full bg-brand" />
            </div>
            <div className="rounded-2xl border bg-card p-5">
              <span className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand">Your next breakthrough</span>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight">A little clarity.<br />A lot of possibility.</h3>
              <p className="mb-6 mt-3 text-sm leading-relaxed text-muted-foreground">A workspace that feels like you. Every detail, in harmony.</p>
              <button type="button" onClick={(event) => event.currentTarget.focus()} className="h-10 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground" data-primary-button>
                Try this button
              </button>
            </div>
            <div className="rounded-xl border p-4">
              <h3 className="mb-3 text-sm font-medium">Light &amp; dark</h3>
              <AppearanceThemeToggle />
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Every palette includes a coordinated dark appearance.</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">Changes preview immediately across the app and last for this session. Calculator colors stay independent for mathematical clarity.</p>
            <button type="button" onClick={() => { reset(); setTheme("light"); }} className="text-left text-sm text-muted-foreground underline underline-offset-4">Reset appearance</button>
          </aside>
        </div>
        <footer className="flex justify-end border-t px-6 py-4">
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground" data-primary-button>
            Back to workspace
          </button>
        </footer>
      </dialog>
    </>
  );
}
