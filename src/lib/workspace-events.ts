/**
 * "New problem" while already on the solver: the sidebar asks the workspace to
 * start over in place, so the page and its Desmos calculator do not reload.
 */
export const NEW_PROBLEM_EVENT = "desmo:new-problem";

type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat"> & {
  target: EventTarget | { closest?: (selector: string) => unknown } | null;
};

/** Where N is text, not a command: form fields, editable text, Desmos, an open dialog. */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .dcg-container, dialog[open]';

/** The N shortcut, ignored while typing, inside Desmos, or with a modifier held. */
export function isNewProblemShortcut(event: ShortcutEvent): boolean {
  if (event.key.toLowerCase() !== "n" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  return !target?.closest?.(TYPING);
}
