/**
 * Grounding for "Explain this". A highlighted passage is explained only when
 * it actually appears in the solution the server resolved for itself (the
 * question, an answer choice, the answer, the prose, or a calculator row), so
 * the tutor cannot be used as a free-form chatbot or fed injected text.
 *
 * What a student can select in rendered math is not the LaTeX that produced
 * it: KaTeX draws y_{1}\sim ax_{1}^{2} as "y1 ∼ ax12", and a student may type
 * it as "y_1 ~ ax_1^2". Both sides are therefore compared by their letters
 * and digits alone, in reading order: LaTeX commands are dropped (a few that
 * render as letters, such as \pi or \sqrt, become those letters), and
 * spacing, braces, scripts, and operators are ignored. Punctuation alone can
 * never carry an instruction, so ignoring it keeps the check both forgiving
 * and safe. No server-only imports: the browser uses the same rules.
 */

export const MAX_SELECTION_CHARS = 400;

/** Commands that render as a letter a student could select. */
const GLYPHS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  Sigma: "Σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
};
/** Commands whose rendering is their own name (prose writes them out: sqrt(3), sin(30)). */
const SPELLED = new Set(["sqrt", "sin", "cos", "tan", "log", "ln", "exp", "min", "max"]);
const COMMAND = /\\([a-zA-Z]+)/y;
const CONTENT = /[\p{L}\p{N}]/u;

export type GroundingKey = {
  /** Lowercased letters and digits, in reading order. */
  key: string;
  /** For each key character, the source span [start, end) that produced it. */
  spans: [number, number][];
};

export function groundingKey(text: string): GroundingKey {
  let key = "";
  const spans: [number, number][] = [];
  const emit = (value: string, start: number, end: number) => {
    for (const char of value.normalize("NFKC").toLowerCase()) {
      if (!CONTENT.test(char)) continue;
      key += char;
      spans.push([start, end]);
    }
  };
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\") {
      COMMAND.lastIndex = index;
      const command = COMMAND.exec(text);
      if (command) {
        const end = index + command[0].length;
        const name = command[1];
        if (GLYPHS[name]) emit(GLYPHS[name], index, end);
        else if (SPELLED.has(name)) emit(name, index, end);
        index = end;
      } else {
        // \{ \} \, \% and the like: punctuation or spacing.
        index += 2;
      }
      continue;
    }
    const char = String.fromCodePoint(text.codePointAt(index)!);
    emit(char, index, index + char.length);
    index += char.length;
  }
  return { key, spans };
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/** Removes invisible and control characters (KaTeX inserts zero-width spaces) and collapses whitespace. */
export function cleanSelection(text: string): string {
  return Array.from(text, (char) => {
    const code = char.codePointAt(0)!;
    const control = (code < 32 || code === 127) && !/\s/.test(char);
    return ZERO_WIDTH.has(code) || control ? "" : char;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when a selection is worth offering to explain: some letter or digit, within the length limit. */
export function isExplainableSelection(text: string): boolean {
  const cleaned = cleanSelection(text);
  return cleaned.length > 0 && cleaned.length <= MAX_SELECTION_CHARS && groundingKey(cleaned).key.length > 0;
}

export type GroundingField = { label: string; text: string };
export type Grounding = {
  /** Where the passage was found, in words the tutor can repeat ("calculator line 2"). */
  field: string;
  /** The matching source text, as the server has it (LaTeX for a row). */
  excerpt: string;
};

/**
 * The first field that contains the selection, or null when the selection
 * is not part of this solution (or contains no letter or digit at all).
 */
export function findGrounding(selection: string, fields: readonly GroundingField[]): Grounding | null {
  const needle = groundingKey(cleanSelection(selection)).key;
  if (!needle) return null;
  for (const field of fields) {
    const { key, spans } = groundingKey(field.text);
    const at = key.indexOf(needle);
    if (at === -1) continue;
    const start = spans[at][0];
    let end = spans[at + needle.length - 1][1];
    // Close a group the match ends inside: x_{1 reads better as x_{1}.
    while (end < field.text.length && field.text[end] === "}") end += 1;
    return { field: field.label, excerpt: field.text.slice(start, end).trim() };
  }
  return null;
}
