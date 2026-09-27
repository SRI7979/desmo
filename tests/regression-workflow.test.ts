import assert from "node:assert/strict";
import { test } from "node:test";
import { hasUnnecessaryCoefficientLists } from "../src/lib/regression-workflow";

const question = "7rx+12sy=3 and 3rx+4sy=5. The solution is (2,y). Find r.";
const rows = (...latex: string[]) => latex.map(latex => ({ latex, purpose: "Copy the givens." }));

test("rejects disposable coefficient-list setups for small systems", () => {
  assert.equal(hasUnnecessaryCoefficientLists(rows("a_{1}=[7,3]", "b_{1}=[12,4]", "c_{1}=[3,5]", "c_{1}\\sim2a_{1}r+b_{1}p", "r"), question), true);
  assert.equal(hasUnnecessaryCoefficientLists(rows("a=[-1,2]", "c=[-337,47]", "c~aq-19w"), "-x-wy=-337 and 2x-wy=47 meet at (q,19)."), true);
});

test("permits direct brackets, real data, identities, and meaningfully reused lists", () => {
  const valid = [
    rows("x_{1}=2", "[7rx_{1}+12sy_{1},3rx_{1}+4sy_{1}]\\sim[3,5]"),
    rows("[7r(2)+12p,3r(2)+4p]~[3,5]", "r"),
    rows("x_{1}=[1,2]", "y_{1}=[3,5]", "y_{1}~mx_{1}+b"),
    rows("x_{1}=[1...5]", "(12x_{1}+28)/4-s/13~r(x_{1}-8)"),
    rows("a=[1,2,3,4]", "b=[5,6,7,8]", "b~ma+c"),
    rows("a=[1,2]", "b=[3,4]", "b~ma+c", "a+b"),
  ];
  for (const plan of valid) assert.equal(hasUnnecessaryCoefficientLists(plan, question), false);
  assert.equal(hasUnnecessaryCoefficientLists(rows("a=[1,2]", "b=[3,4]", "b~ma+c"), "Fit these observed data."), false);
});
