/**
 * The controlled vocabulary of solving techniques. A candidate method must name
 * exactly one of these ids; free-form names are a validation failure, because
 * the same technique named three ways across three problems is a technique a
 * student never learns to recognize.
 *
 * Library techniques are annotated in src/content/desmos-tricks.md as
 * `[technique: id | Display name]` directly under the strategy that teaches
 * them. Several strategies may share one id when they teach the same move
 * (strategies 1, 3, 5, 6, ... are all "Graph both sides"). Standard techniques
 * are the paper methods the library does not teach; they give a student who
 * prefers algebra a real option.
 */
export type TechniqueSource = "library" | "standard";

export type Technique = {
  id: string;
  name: string;
  source: TechniqueSource;
  /** Named in the one-line shape when the method rests on this fact. */
  fact?: string;
  /** Standard techniques only: when the technique genuinely applies. */
  use?: string;
  /** Standard techniques only: written steps the technique needs by definition. */
  minSteps?: number;
};

export const TECHNIQUES = [
  { id: "graph-raw", name: "Graph as written", source: "library" },
  { id: "graph-both-sides", name: "Graph both sides", source: "library" },
  { id: "intercept-read", name: "Read the intercepts", source: "library" },
  { id: "count-intersections", name: "Count the intersections", source: "library" },
  { id: "vertex-read", name: "Click the vertex", source: "library" },
  { id: "restricted-extremum", name: "Restricted-domain max/min", source: "library" },
  { id: "linear-regression", name: "Linear regression", source: "library" },
  { id: "three-point-regression", name: "Three-point regression", source: "library" },
  { id: "exponential-regression", name: "Exponential regression", source: "library" },
  { id: "parameter-regression", name: "Parameter regression", source: "library" },
  { id: "answer-choice-list", name: "Answer-choice list test", source: "library" },
  { id: "integer-list-filter", name: "Integer list filter", source: "library" },
  { id: "list-evaluation", name: "Evaluate over a list", source: "library" },
  { id: "function-evaluation", name: "Function evaluation", source: "library" },
  { id: "graph-inequality", name: "Graph the inequality", source: "library" },
  { id: "derivative-regression", name: "Derivative regression", source: "library" },
  { id: "expanded-circle", name: "Expanded-circle regression", source: "library" },
  { id: "story-system", name: "Story to equations", source: "library" },
  { id: "statistics-builtin", name: "Statistics built-in", source: "library" },
  { id: "distance-builtin", name: "distance() built-in", source: "library" },
  { id: "midpoint-builtin", name: "midpoint() built-in", source: "library" },
  { id: "reference-formula", name: "Reference-sheet formula", source: "library" },
  { id: "trig-evaluation", name: "Direct trig evaluation", source: "library" },
  { id: "inverse-trig", name: "Inverse trig", source: "library" },
  { id: "right-triangle-trig", name: "SOHCAHTOA", source: "library" },
  { id: "slider-condition", name: "Slider until it fits", source: "library" },
  { id: "choice-window", name: "Zoom to the choices", source: "library" },
  { id: "identity-regression", name: "Identity regression", source: "library" },
  { id: "bracket-regression", name: "Bracket regression", source: "library" },
  { id: "slider-parallel", name: "Slider until parallel", source: "library" },
  { id: "graph-each-choice", name: "Graph each choice", source: "library" },
  { id: "frequency-repeat", name: "repeat() for frequencies", source: "library" },
  { id: "ceil-floor", name: "ceil/floor for whole groups", source: "library" },
  { id: "polygon-area", name: "polygon() area", source: "library" },
  { id: "number-theory-builtin", name: "mod/gcd/lcm built-ins", source: "library" },
  { id: "sum-product", name: "Sum/product notation", source: "library" },
  { id: "derivative-slope", name: "Derivative slope finder", source: "library" },
  { id: "strategic-value-test", name: "Strategic-value testing", source: "library" },
  { id: "shared-zero", name: "Shared zero", source: "library" },
  {
    id: "quadratic-formula",
    name: "Quadratic formula",
    source: "standard",
    fact: "quadratic formula",
    minSteps: 1,
    use: "a quadratic's roots when it does not factor nicely",
  },
  {
    id: "factoring",
    name: "Factoring",
    source: "standard",
    fact: "factoring",
    minSteps: 1,
    use: "a polynomial that factors over the integers by inspection",
  },
  {
    id: "completing-the-square",
    name: "Completing the square",
    source: "standard",
    fact: "completing the square",
    minSteps: 2,
    use: "a vertex or circle center when the algebra is short",
  },
  {
    id: "substitution",
    name: "Substitution",
    source: "standard",
    minSteps: 2,
    use: "a system where one equation is already solved for a variable",
  },
  {
    id: "elimination",
    name: "Elimination",
    source: "standard",
    minSteps: 2,
    use: "a linear system whose coefficients cancel after one multiplication",
  },
  {
    id: "plug-in-choices",
    name: "Plug in the answer choices",
    source: "standard",
    minSteps: 1,
    use: "multiple choice where testing each choice by hand is quick",
  },
  {
    id: "direct-arithmetic",
    name: "Direct arithmetic",
    source: "standard",
    minSteps: 1,
    use: "a value computed directly from the givens in one or two arithmetic steps",
  },
  {
    id: "translate-the-words",
    name: "Translate the words",
    source: "standard",
    use: "choosing the equation or expression that represents a situation; the task ends once the model matches a choice",
  },
] as const satisfies readonly Technique[];

export type TechniqueId = (typeof TECHNIQUES)[number]["id"];

export const TECHNIQUE_IDS = TECHNIQUES.map((technique) => technique.id) as [
  TechniqueId,
  ...TechniqueId[],
];

const byId = new Map<string, Technique>(TECHNIQUES.map((technique) => [technique.id, technique]));

export function isTechniqueId(value: string): value is TechniqueId {
  return byId.has(value);
}

export function getTechnique(id: TechniqueId): Technique {
  return byId.get(id)!;
}

export function techniqueName(id: TechniqueId): string {
  return getTechnique(id).name;
}

/** The annotation form used in desmos-tricks.md: [technique: id | Display name]. */
export const TECHNIQUE_ANNOTATION = /^\[technique: ([a-z0-9-]+) \| ([^\]]+)\]$/;

/** Prompt text: the standard techniques the library does not cover. */
export function standardTechniqueGuide(): string {
  return TECHNIQUES.filter((technique) => technique.source === "standard")
    .map((technique) => `- ${technique.id} (${technique.name}): ${"use" in technique ? technique.use : ""}`)
    .join("\n");
}
