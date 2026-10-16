export const PALETTES = [
  { name: 'Botanical', note: 'Evergreen · sage · porcelain', light: ['#f3f5ef','#ffffff','#18281f','#456252','#dce9dc','#216343','#ffffff','#d3ddd3'], dark: ['#101912','#18241b','#edf4e9','#afc3b0','#263c2c','#a9d7ad','#132b1c','#354637'] },
  { name: 'Espresso', note: 'Coffee · oat · warm cream', light: ['#f5efe5','#fffbf3','#35271f','#78624e','#ede0ca','#79533a','#ffffff','#dfd0b9'], dark: ['#1c1713','#29211b','#f6ebdc','#c7b29a','#3a2d22','#dec09b','#302116','#4b3b2d'] },
  { name: 'Tidal', note: 'Ink · sea glass · cloud', light: ['#eef5f6','#ffffff','#172d35','#526c74','#dceef0','#216978','#ffffff','#cadde1'], dark: ['#101b20','#17272e','#e6f3f5','#a3c0c8','#233e47','#94ced9','#112d34','#314b55'] },
  { name: 'Atelier', note: 'Aubergine · lilac · chalk', light: ['#f5f2f8','#fffdff','#32253b','#74627f','#eae0f3','#75508e','#ffffff','#e0d4e9'], dark: ['#1a151f','#251e2d','#f4eafa','#c1aecb','#392b45','#d3b1e8','#30203e','#483752'] },
  { name: 'Terracotta', note: 'Clay · apricot · sandstone', light: ['#f8f1eb','#fffcf8','#3b2922','#826154','#f2e0d3','#985338','#ffffff','#e7d2c5'], dark: ['#211713','#30221c','#faece2','#d1b19e','#452e24','#efb194','#381e12','#513a2e'] },
  { name: 'Blueprint', note: 'Cobalt · mist · paper', light: ['#f3f6fb','#ffffff','#192c46','#596e89','#e2ecfb','#355fa3','#ffffff','#d5dfed'], dark: ['#101823','#1b2636','#edf3fc','#a5b8d1','#293b54','#a2c2f5','#182d4e','#384b65'] },
] as const

export type AppearancePreferences = {
  palette: number;
  text: "Modern" | "Editorial" | "Technical";
  button: "Solid" | "Outline" | "Raised";
  corners: "Crisp" | "Soft" | "Round";
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  palette: 2, text: "Modern", button: "Raised", corners: "Round",
};
export const APPEARANCE_STORAGE_KEY = "desmo-appearance";

export function parseAppearance(value: string | null): AppearancePreferences {
  try {
    const input = JSON.parse(value ?? "null");
    if (!input || typeof input !== "object") return { ...DEFAULT_APPEARANCE };
    return {
      palette: Number.isInteger(input.palette) && input.palette >= 0 && input.palette < PALETTES.length ? input.palette : DEFAULT_APPEARANCE.palette,
      text: ["Modern", "Editorial", "Technical"].includes(input.text) ? input.text : DEFAULT_APPEARANCE.text,
      button: ["Solid", "Outline", "Raised"].includes(input.button) ? input.button : DEFAULT_APPEARANCE.button,
      corners: ["Crisp", "Soft", "Round"].includes(input.corners) ? input.corners : DEFAULT_APPEARANCE.corners,
    };
  } catch { return { ...DEFAULT_APPEARANCE }; }
}

/** Source tokens, with aliases for the real app's existing CSS modules.
 * Legacy --muted means text; prototype surface utilities use --ui-muted.
 * Tokens live on workspace shells, never on unrelated routes or Desmos rows.
 */
export function appearanceTokens(preferences: AppearancePreferences, dark: boolean): Record<string, string> {
  const palette = PALETTES[preferences.palette] ?? PALETTES[DEFAULT_APPEARANCE.palette];
  const [background, card, foreground, mutedText, soft, brand, primaryText, border] = dark ? palette.dark : palette.light;
  const radius = preferences.corners === "Crisp" ? "0.25rem" : preferences.corners === "Round" ? "1rem" : "0.625rem";
  return {
    background, card, foreground, popover: card,
    "card-foreground": foreground, "popover-foreground": foreground,
    primary: brand, "primary-foreground": primaryText,
    secondary: soft, "secondary-foreground": foreground,
    muted: mutedText, "ui-muted": soft, "muted-foreground": mutedText, subtle: mutedText,
    accent: soft, "accent-foreground": foreground, brand, "brand-soft": soft,
    success: brand, border, input: border, ring: brand, radius,
    "radius-sm": `calc(${radius} - 6px)`, "radius-md": `calc(${radius} - 4px)`,
    "radius-lg": radius, "radius-xl": `calc(${radius} + 4px)`, "radius-2xl": `calc(${radius} + 8px)`,
    surface: soft, "surface-raised": card, "surface-muted": background,
    "accent-ink": brand, "accent-text": brand, "accent-soft": soft,
    "accent-hover": brand, "accent-pressed": brand, "answer-surface": soft,
    "border-subtle": border, "border-strong": border, "border-accent": brand,
    "success-soft": soft, "panel-header": card, "trace-line": border,
    "danger": dark ? "#ffaaa6" : "#b3363b", "danger-soft": dark ? "#3b2328" : "#fff2f2",
    destructive: "#e5484d",
    "shadow-card": dark ? "0 0 0 1px #ffffff0d" : "0 0 0 1px #1118270f",
    "shadow-pop": dark ? "0 24px 64px -12px #000000b3, 0 0 0 1px #ffffff14" : "0 24px 48px -12px #0b0b0d29, 0 0 0 1px #0b0b0d14",
    "shadow-float": dark ? "0 24px 64px -12px #000000b3, 0 0 0 1px #ffffff14" : "0 24px 48px -12px #0b0b0d29, 0 0 0 1px #0b0b0d14",
    "font-sans": preferences.text === "Editorial" ? 'Georgia, "Times New Roman", serif' : preferences.text === "Technical" ? 'var(--font-geist-mono), ui-monospace, monospace' : 'var(--font-geist), ui-sans-serif, system-ui, sans-serif',
    "font-mono": "var(--font-geist-mono), ui-monospace, monospace",
  };
}
