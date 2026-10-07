/** The prototype integration's pure helpers: the calculator's dark palette and the N shortcut. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { displayColor } from "../src/lib/desmos-engine";
import { isNewProblemShortcut } from "../src/lib/workspace-events";

test("dark mode pre-inverts each row color, so Desmos's inversion shows the light theme's color", () => {
  assert.equal(displayColor("#169ed5", false), "#169ed5", "light mode is untouched");
  assert.equal(displayColor("#169ed5", true), "#e9612a");
  for (const color of ["#169ed5", "#8a5ce6", "#e78a29", "#229b6b", "#000000", "#ffffff"]) {
    assert.equal(displayColor(displayColor(color, true), true), color, `${color} round-trips`);
  }
  assert.equal(displayColor("red", true), "red", "a non-hex color is left to Desmos");
});

test("N starts a new problem only when the student is not typing, in Desmos, or holding a modifier", () => {
  const key = (overrides: Partial<Parameters<typeof isNewProblemShortcut>[0]> = {}) =>
    isNewProblemShortcut({ key: "n", metaKey: false, ctrlKey: false, altKey: false, repeat: false, target: { closest: () => null }, ...overrides });
  assert.equal(key(), true);
  assert.equal(key({ key: "N" }), true, "Shift+N too");
  assert.equal(key({ key: "m" }), false);
  for (const modifier of ["metaKey", "ctrlKey", "altKey", "repeat"] as const) assert.equal(key({ [modifier]: true }), false, modifier);
  assert.equal(key({ target: { closest: (selector: string) => (selector.includes("textarea") ? {} : null) } }), false, "inside a field, Desmos, or a dialog");
  assert.equal(key({ target: null }), true);
});
