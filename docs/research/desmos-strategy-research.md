# Desmos SAT strategy research: gaps in the strategy library

Research input for `src/content/desmos-tricks.md` (76 strategies), routing, and
scoring. Written 2026-10-04. Every example problem below is original; its
answer was checked with sympy
(`/tmp/claude-0/-home-user-desmo/4e96287a-47a6-5f4e-a8d6-b3a6e0bf63cb/scratchpad/research/verify_research.py`).
**Fact-check update:** the draft said no row had run in Desmos. A later
fact-check ran every row through the app's own pre-flight engine in real
Desmos (API v1.11.4, headless Playwright Chromium, the app's degree-mode
options). It also screenshotted the visual claims after simulated clicks.
Every row runs without error and gives the stated value. Several visual
claims were wrong and are corrected below (see the Verification log at the
end). Bluebook's own build was not available, so test-day behavior is still
unverified.

**Major limitation, read first.** The network egress proxy blocked every page
fetch, including youtube.com, tiktok.com, skool.com, oneprep.com/.co,
scribd.com, desmos.scottssatprep.com, help.desmos.com, desmos.com,
collegeboard.org, reddit mirrors, acely.com, prepmaven.com and
sayhellocollege.com. Only the search tool worked. So all evidence comes from
search-engine result summaries, not from the pages, videos or transcripts.
I could confirm Scott Robinson's identity, his resources, and the topics he
teaches, but not the exact content of his videos. Claims that rest on one
summary are marked (S) and listed again in section (f).

---

## (a) Sources consulted and how reliable they are

Reliability tiers: **A** is official Desmos or College Board documentation.
**B** is an established tutor or course with a track record. **C** is an
aggregator or marketing blog. A **(S)** marker means the claim was seen only
in a search-engine summary of the page, which can paraphrase badly.

| Source | What it contributed | Tier |
|---|---|---|
| Scott Robinson / @scottsSATprep. Skool community https://www.skool.com/scotts-sat-prep-2430 ; free guide https://desmos.scottssatprep.com/ and https://desmosguide.scottssatprep.com/ ; guide PDF https://www.scribd.com/document/975081603/ScottsSATprep-s-SAT-Math-Desmos-Master-Guide ; course https://www.oneprep.com/course/sat-math-walkthrough-videos ; tutoring https://www.scottssatprep.com/ ; TikTok https://www.tiktok.com/@scottssatprep/video/7512645992102087967 and https://www.tiktok.com/@scottssatprep/video/7540017470363536670 | Identity: 1580 scorer, four 800 Math scores, active on YouTube, TikTok and Instagram. The guide covers single-variable equations, systems, regression and inequalities, plus planning and strategic skipping. Video topics: swap "=" for "~" to solve for a variable; drag a slider until the graph has exactly one solution; identity regression on `x_1=random(10)`, then type `a+b+c`; list regression for percentage word problems with several unknowns, plus a workaround for a "% of" quirk; a video titled "Broken Desmos Method: What's Going On?" whose content is unknown. | B (S) |
| 1600.io Desmos course https://1600.io/courses/1698988 ; lecture "Using Regression to Find Both Solutions to a Quadratic Equation" https://1600.io/courses/1698988/lectures/47466973 | A second search summary says the lecture treats graphing as the usual default. Graph decimals cannot give exact forms such as -3+√11, so the lecture teaches a regression setup that recovers BOTH solutions exactly. The draft's paraphrase "graphing is usually better when both roots are needed" is not supported and was removed. That a plain regression returns only one root is verified directly in Desmos instead: `p^{2}-3p\sim10` returns only p=-2. | B (S) |
| r/Sat "Official Desmos thread" (moderator comments; the regression wording matches 1600.io's). Mirror: https://cal1.lr.ggtyler.dev/r/Sat/comments/1c8at7a/official_desmos_thread | Bracket regression for systems (left sides in one list, right sides in another). Desmos lets you click the TOP and BOTTOM points of a circle but not the left or right points (confirmed in Desmos 1.11.4 by the fact-check). To test "infinitely many", hide one graph and see whether the other was on top of it. | B (S) |
| Mike McClenathan (PWN the SAT / MathChops), https://mathchops.substack.com/p/a-five-minute-dsat-desmos-intro | A mean-equals-median question for an unknown is typed as ONE line, `mean(2,3,4,5,x)=median(2,3,4,5,x)`, and read from the graph. A second search summary agrees. | B (S) |
| Desmos Help, "Nonlinear Regressions": https://help.desmos.com/hc/en-us/articles/360042428612-Nonlinear-Regressions | Regressions can stop at a local minimum. Initial guesses fall between -5000 and 5000, concentrated near 0, so rescale data whose parameters are large. Parameters can be restricted inside the regression, e.g. `y_1~ax_1^b{1<b<5}`. A second search did not find the ±5000 range, so treat it as unconfirmed. The restriction works in Desmos 1.11.4: `p^{2}-3p\sim10\{p>0\}` returns 5. | A (S) |
| Desmos Help, "List Operations": https://help.desmos.com/hc/en-us/articles/43732228059533-List-Operations | `repeat(list, counts)` is a documented public function. | A (S) |
| Desmos Help, "Assessment Resources & FAQ": https://help.desmos.com/hc/en-us/articles/30913914831757 ; College Board testing PDFs: https://desmos.com/assessment-pdfs/CollegeBoard_Desmos_Calculator_AP_SAT.pdf and https://www.desmos.com/static-assets/assessment-pdfs/CollegeBoard_Desmos_Calculator.pdf | The SAT build defaults to degrees. Its keypad is alphabetical. Images, notes and folders are disabled. csc/sec/cot, the hyperbolic functions and their inverses, mad and cov are unavailable. Log mode is ON by default for exponential, log and power regressions. Some state configurations also disable distance, midpoint and random, but those lists did not appear to be the SAT one. | A (S) |
| Desmos blog, Points of Interest: https://blog.desmos.com/articles/how-to-points-of-interest/ | Desmos marks maxima, minima, intercepts and intersections, and these points update while a slider moves. | A (S) |
| SayHelloCollege: https://sayhellocollege.com/blog/guide-to-using-the-desmos-sat-calculator/ | The "vertical line method": type a one-variable equation as written and read the x-values of the vertical lines. Rename any other letter to x, or Desmos offers a slider. Zoom out if nothing appears. Checking equivalence with a table is slow because you cannot paste the question into Desmos. | C (S) |
| Acely cheat sheet and guide library: https://acely.com/sat-prep/desmos-cheat-sheet , https://acely.com/desmos-guide-library ; Desmos "% of" note: https://blog.desmos.com/articles/friday-fave-for-september-15 | Overlay the original and the choices to find the equivalent expression. The fraction-toggle button exists for rational results. `p% of 20 ~ 9` solves for p. | C (S) |
| OnePrep blogs: https://www.oneprep.co/blog/sat-math-tips-desmos-2026-12-calculator-moves | When NOT to use Desmos: a one-step problem, a conceptual question, or "if Desmos requires you to build more than you'd write". A second search could not locate this page or the quoted phrase, so the quote is unconfirmed. | C (S) |
| Vibrant Publishers: https://www.vibrantpublishers.com/blogs/blogs-on-act-sat/how-to-use-the-desmos-calculator-on-the-digital-sat | "Under 20–30 seconds by hand, solve by hand." Skip two-step linear equations and basic percent arithmetic. | C (S) |
| PrepMaven: https://prepmaven.com/blog/test-prep/desmos-on-the-digital-sat/ ; CheetahPrep: https://www.cheetahprep.com/desmos/system-linear-equations-infinite | Sliders, tables and regression as core skills. Sliders for no / one / infinitely many solutions. | C (S) |
| Patrick Honner, "When Desmos Fails": https://mrhonner.com/archives/11643 | A second search summary says the article examines Desmos's odd rendering near the hole of (x+2)/(x²+3x+2) under extreme zoom, a floating-point limit. That is not a general "Desmos does not draw holes" claim, so the draft's attribution was too broad. The no-hole behavior is verified directly instead: y=(x²-1)/(x-1) draws an unbroken line through (1,2). | B (S) |
| Desmos community, angle modes: https://cl.desmos.com/t/inconsistencies-in-angle-mode-between-regular-and-testing-graphing-calculator-angle-modes/7825 | desmos.com defaults to radians; the testing calculator defaults to degrees. | B (S) |
| SPR entry rules: https://open-exam-prep.com/study-guides/sat-math/introduction/pacing-spr-tactics , https://collegeprep.uworld.com/blog/how-to-fill-grid-ins-sat-math/ | Student-produced responses allow 5 characters, or 6 for a negative. Longer decimals may be rounded or truncated, e.g. 2/3 as .6666, .6667 or 0.667. | B (S) |

Not useful: the many scraped or "AI-content" sites that rank for "desmos
tips for sat" (grinnell.edu PDF mirrors, propertystream, verde.ag). They
repeat generic advice. LearnDesmos (https://learndesmos.com/curriculum/regression)
gives percentages of SAT Math solvable by each regression type, but cites no
method, so I did not use them.

---

## (b) Technique entries

Field key: **Trig** is the trigger. **Alg** is what a generic model does by
default. **Desmos** is the Desmos-native plan, with the rows and what the
student reads. **Why** names the hidden derivation the method avoids.
**Prim** lists the primitives used (W marks a cost-model whitelist item).
**Not when** gives the failure modes. **Lib** is the closest library strategy
and technique id, with a verdict: adequate, weak, missing, or contradicts.
**Ex** is an original problem with its verified answer.

### E1. Type a one-variable equation as written and read the vertical lines
- Category: visual · technique `graph-raw` · Lib: #2 and #3. **Missing.** The
  library graphs equations in x and y as written (#2) and graphs both sides
  (#3). It never says that an equation in x alone plots as vertical lines at
  its solutions, and it never states the rename-to-x rule.
- Trig: the problem asks to "solve" or for "a solution" of one equation in one
  variable, or "how many solutions". Also covers a one-variable inequality:
  `3(x-2)>5x+4` shades the band x<-5 with a dashed edge (verified).
- Alg: cross-multiply, expand, collect terms, then factor or use the quadratic
  formula, then check for extraneous roots.
- Desmos: one row, the equation exactly as printed. When the variable is not
  x (p, t, w), retype it as x first. Otherwise Desmos treats the letter as a
  slider. Desmos draws a vertical line at each real solution (verified;
  extraneous roots are not drawn). **Labels depend on the form (verified in
  Desmos 1.11.4):** when the equation is a polynomial of degree at most 2 in
  x, clicking a line labels its axis crossing (`x^{2}=5` gives (2.23607,0);
  `(x-3)^{2}=2(x+1)` gives (1,0) and (7,0)). Rational, radical,
  absolute-value, exponential and cubic forms draw the lines with NO points of
  interest. The value is then read off the grid, which is exact only when it
  sits on a gridline. A tutor source and Scott's guide both describe this as
  the first method for one-variable equations (S).
- Why: no cross-multiplying or rearranging, and no case splits. It is one row
  instead of #3's two whenever the read is exact. It also counts the
  solutions at a glance.
- Prim: graphing raw (W).
- Not when: the equation has a parameter the question wants left free. A
  non-gridline answer from an unlabelled form also rules it out: use #3, whose
  intersections are labelled. A blank view proves nothing. An identity
  (`2(x+1)=2x+2`) and a contradiction (`x+1=x+2`) BOTH draw nothing, with no
  warning (verified), and off-screen solutions also leave the view blank. Zoom
  out, then use #3: overlapping graphs mean every x works, and parallel graphs
  mean no solution.
- Ex: *What is the greater solution of (x-3)²/(x+1) = 2?* Answer **7** (the
  solutions are 1 and 7).
  ```
  \frac{(x-3)^{2}}{x+1}=2
  ```
  The lines sit on the gridlines x=1 and x=7 (verified). They carry no labels
  because the form is rational. For a labelled read, graph `y=\frac{(x-3)^{2}}{x+1}`
  and `y=2` and click (1,2) and (7,2) (verified).

### E2. Extraneous roots: the graph shows only the real ones
- Category: intersection · `graph-both-sides` · Lib: #3 (lists radicals).
  **Weak.** The library never mentions extraneous solutions, and the SAT asks
  about them directly ("which value is an extraneous solution").
- Trig: a radical or rational equation; "extraneous" or "how many solutions"
  in the question.
- Alg: square both sides, solve the quadratic, then substitute back. Generic
  models often skip the substitution and report both roots.
- Desmos: graph the original two sides; only the true solution is an
  intersection. For "which is extraneous", also graph the squared version
  printed in the problem. The extra crossing there is the extraneous root.
- Why: no back-substitution step, and no squaring by hand.
- Prim: graphing (W).
- Not when: the draft said the squared version must be given or derived.
  That is too strict. When the problem never prints it, the extraneous root is
  where the other branch `y=-\sqrt{x+7}` meets `y=x-5`. That intersection is
  labelled (2,-3) (verified), and nothing has to be squared by hand.
- Ex: *How many solutions does √(x+7) = x-5 have, and which value from the
  squared equation is extraneous?* Answer: **one solution, x=9**; **2 is
  extraneous**.
  ```
  y=\sqrt{x+7}
  y=x-5
  ```
  One intersection at (9,4). Optionally add `y=(x-5)^{2}` and `y=x+7`. These
  meet at x=2 and x=9, and 2 is the crossing the first pair lacks, so it is
  the extraneous root. Typing `\sqrt{x+7}=x-5` raw draws only the line x=9
  (verified).

### E3. Circle in general form: click the top and bottom points
- Category: visual · `expanded-circle` · Lib: #36. **Contradicts the
  default.** #36 fits 6 sample pairs, but 3 non-collinear pairs determine the
  identity: the x² and y² terms cancel, leaving a linear function of x and y.
  Tutors instead graph the equation and read it.
- Trig: x²+y²+Dx+Ey+F=0; the question asks for the center, radius, or r².
- Alg: complete the square twice. Alternatively recall center (-D/2,-E/2),
  which is a one-off fact.
- Desmos: graph the equation as written. Desmos marks the circle's top and
  bottom points but not its left and right ones (r/Sat, (S)). This is
  confirmed in Desmos 1.11.4: clicking the circle shows gray points at the top,
  the bottom and the axis crossings, none at the left or right, and clicking
  the top labels (-4,10). Then:
  center = (x of top, average of the two y's); radius = half the vertical gap.
  For an exact r² when the radius is irrational, use the trimmed regression.
- Why: no completing the square, and no center formula.
- Prim: graphing (W), clicking points (W). The trimmed regression is also W.
- Not when: a choice needs an exact radical like √19. Labels carry 5
  decimals: x²+y²-4x+6y-6=0 labels (2,1.3589) and (2,-7.3589) (verified).
  The squared half-gap is 19.000009, but compare the choices numerically (E8).
  If the student's build (Bluebook is unverified) does not label the top and
  bottom, use the regression.
- Ex: *A circle is x²+y²+8x-6y-24=0. What is its radius?* Answer **7**,
  center (-4,3).
  ```
  x^{2}+y^{2}+8x-6y-24=0
  ```
  Top (-4,10) and bottom (-4,-4): radius (10-(-4))/2 = 7. Deterministic
  alternative (3 samples, not 6):
  ```
  x_{1}=[0,1,0]
  y_{1}=[0,0,1]
  x_{1}^{2}+y_{1}^{2}+8x_{1}-6y_{1}-24\sim(x_{1}-h)^{2}+(y_{1}-k)^{2}-q
  \sqrt{q}
  ```
  Fits h=-4, k=3, q=49 uniquely (checked).

### E4. "Which expression is equivalent?": evaluate every choice at one test value, or overlay
- Category: answer-choice · `strategic-value-test`, or `graph-each-choice`
  for the visual version · Lib: #60. **Contradicts.** #60 routes "which of the
  following is equivalent" to identity regression. That is the right tool
  when the constants are unknown. When the choices are fully numeric, tutors
  use an overlay or a one-value test, which is cheaper.
- Trig: multiple choice and "which expression is equivalent to…", with no
  unknown constants.
- Alg: factor, cancel, expand, combine.
- Desmos: define the original once and the choices as one list-valued
  function, then evaluate both at one legal non-special value. The zero entry
  is the match. Visual alternative: graph y=f(x) and each choice. A tutor
  source says to hide one graph to see whether the other was underneath it
  (S).
- Why: no algebraic simplification.
- Prim: functions (W), lists (W).
- Not when: two choices agree at the test value. Use a second value in a
  second row. Never use `f(x_1)-g(x_1)` with list inputs: Desmos rejects it
  with "Cannot store a list of numbers in a list" (verified). Desmos does not
  draw holes (verified: y=(x²-1)/(x-1) is an unbroken line), so an overlay
  hides a domain difference such as x≠-3/2. Avoid excluded values as test
  inputs. Never put all the choices in one list-graph if the student must
  tell which curve is which, because every list member draws in the same
  color (verified).
- Ex: *Which is equivalent to (4x²+12x+9)/(2x+3) - (x-1) for x>0? A) x+4 B)
  x+2 C) 3x+4 D) 3x+2.* Answer **x+4** (choice A).
  ```
  f(x)=\frac{4x^{2}+12x+9}{2x+3}-(x-1)
  g(x)=[x+4,x+2,3x+4,3x+2]
  f(5)-g(5)
  ```
  The output [0,2,-10,-8] has its zero in position A (checked).

### E5. A nuisance constant does not change the answer: give it any legal value
- Category: slider · `vertex-read`, or `strategic-value-test` for symbolic
  choices · Lib: #74 covers symbolic choices only. **Missing** for numeric
  answers.
- Trig: "a is a nonzero constant" (or "k > 0") while the question asks for
  something that does not depend on it: the vertex x, the axis of symmetry,
  the x-intercepts, or a ratio.
- Alg: the vertex x is the midpoint of the roots, or -b/(2a) after expanding
  (a formula plus derivation).
- Desmos: make the constant a slider at any legal value and read the feature.
  Drag the slider once to show the answer does not move; that drag doubles as
  the check that the answer is invariant.
- Why: no vertex formula and no expansion.
- Prim: slider (W), vertex click (W).
- Not when: the answer DOES depend on the constant. The drag reveals this,
  and then this is not the method. The chosen value must satisfy every stated
  condition (a≠0, a>0).
- Ex: *f(x)=a(x-3)(x+7), where a is a nonzero constant. What is the
  x-coordinate of the vertex?* Answer **-2**.
  ```
  a=1
  y=a(x-3)(x+7)
  ```
  The slider runs -5 to 5. The vertex is (-2,-25), and its x stays -2 as a
  moves. At a=0 the graph flattens to y=0. That is the excluded value, not a
  counterexample. A range such as 0.5 to 5 avoids it.

### E6. Graph a statistic as a function of the unknown
- Category: visual + built-in · `statistics-builtin` (with `graph-both-sides`) ·
  Lib: #45–48. **Missing.** The library only evaluates statistics of fixed
  lists.
- Trig: a data set contains an unknown value x, and a condition links two
  statistics or a statistic and a number ("mean equals median", "the median
  is 12", "the range is 20").
- Alg: case analysis on where x falls in the sorted order. Generic models
  usually find one case and miss the others.
- Desmos: MathChops types one row, statistic(list with x) = statistic(list
  with x), and reads the vertical lines (S). The row works in Desmos 1.11.4,
  but its lines carry NO labels (verified, as for other non-polynomial forms
  in E1). Graph the two statistics as two functions of x instead,
  `y=mean([...,x])` and `y=median([...,x])`. Every crossing is then a
  labelled point of interest (verified).
- Why: no case analysis, and every solution appears at once.
- Prim: statistics functions (W), graphing (W).
- Not when: x must be an integer or must come from a set. Filter or list-test
  instead (#65). Also watch the window: solutions can sit far apart (x=16 is
  outside the default ±10 view).
- Ex: *The data set 4, 9, 11, 15, x has mean equal to median. What is the sum
  of all possible values of x?* Answer **31.75** (x = 6, 9.75, 16; checked by
  exact case analysis).
  ```
  y=\operatorname{mean}([4,9,11,15,x])
  y=\operatorname{median}([4,9,11,15,x])
  ```
  Three crossings: (6,9), (9.75,9.75) and (16,11). Clicking the middle one
  labels (9.75, 9.75) (verified). The one-row form
  `\operatorname{mean}([4,9,11,15,x])=\operatorname{median}([4,9,11,15,x])`
  draws unlabelled lines at the same three x-values (verified). 6 and 16 sit
  on gridlines, but 9.75 cannot be read exactly from that form.

### E7. A rate over a different period: compare f(1) with f(0)
- Category: built-in · `function-evaluation` · Lib: #16, #41, #74. **Weak.**
  #16 fits a percent from data. #74 uses (f(1)-f(0))/f(0) only inside symbolic
  multiple choice. Neither covers a model already given in a non-unit period,
  such as (0.64)^(t/2) or 1.2^(t/12), asked per year or per month.
- Trig: an exponential model with a fractional exponent (t/2, 12t, t/12),
  asking for the percent growth or decay per unit time.
- Alg: exponent rules (√0.64 = 0.8, or 1.2^(1/12)), then the 1-b conversion.
- Desmos: define the model as printed and evaluate the change over ONE unit
  of the asked period. For "per month" with t in years, use f(1/12)/f(0).
- Why: no exponent laws and no growth-factor conversion.
- Prim: functions (W).
- Not when: the question asks which EXPRESSION shows the rate. That is
  representation, so translate (or E4 for equivalent forms).
- Ex: *A machine's value t years after purchase is 800(0.64)^(t/2) dollars. By
  what percent does its value decrease each year?* Answer **20**.
  ```
  f(t)=800(0.64)^{\frac{t}{2}}
  100\left(1-\frac{f(1)}{f(0)}\right)
  ```
  The second row reads 20 (verified in Desmos).

### E8. Match an exact radical or fraction choice by evaluating the choices as a list
- Category: answer-choice · `answer-choice-list` · Lib: #49 (warns only
  "do not claim the decimal is exact"). **Weak.** The library gives no
  matching step.
- Trig: the calculator gives a decimal; the choices are radicals, π-multiples
  or fractions.
- Alg: simplify the radical by hand (√72 = 6√2).
- Desmos: compute the value, then put the choices in a list. The matching
  entry is the answer.
- Why: no radical simplification.
- Prim: lists (W); `distance()` is a new primitive in the cost model.
- Not when: two choices agree to 4 decimals (rare). A student-produced
  response that requires an exact form cannot be entered from a decimal.
- Ex: *What is the distance between (-1,4) and (5,-2)? A) 2√6 B) 6√2 C) 12
  D) 6√3.* Answer **6√2**.
  ```
  \operatorname{distance}((-1,4),(5,-2))
  [2\sqrt{6},6\sqrt{2},12,6\sqrt{3}]
  ```
  The output 8.4853 matches the second entry (checked: 8.48528; Desmos
  returns 8.485281374 for both).

### E9. Construct the figure on the axes when it removes a formula
- Category: intersection · `graph-both-sides` · Lib: #68 assumes the
  coordinates are given. **Missing.** (The draft also offered `polygon-area`
  for the area. That cannot work in the embedded build: in Desmos 1.11.4 a
  `polygon()` row displays no area, and `area()` errors with "This calculator
  does not support the 'area' function" (verified). See (f) 8.)
- Trig: a triangle given by side lengths, with no coordinates or altitude,
  asking for area, height or an angle. Heron's formula and the law of cosines
  are not on the reference sheet.
- Alg: Heron's formula, which is a one-off fact, or a two-equation altitude
  system solved by hand.
- Desmos: put one side on the x-axis from (0,0) to (c,0). Draw circles of the
  other two radii around its endpoints; their intersection is the third
  vertex. Read the height, then use the reference-sheet ½bh.
- Why: no Heron's formula and no altitude derivation. The two circle
  equations are the distance definition typed with the givens (circles on the
  reference sheet; r² = 169 means r = 13).
- Prim: graphing implicit (W), intersection (W), reference formula (free).
- Not when: the triangle is right, 30-60-90 or 45-45-90. The reference sheet
  is faster there. Also beware angle questions that need degree mode and
  inverse trig, which is a new primitive.
- Ex: *A triangle has sides 13, 14 and 15. What is its area?* Answer **84**.
  ```
  x^{2}+y^{2}=169
  (x-14)^{2}+y^{2}=225
  \frac{1}{2}(14)(12)
  ```
  Click the upper intersection, which is labelled (5,12) (verified). The
  height is 12 and the area is 84 (checked against Heron).

### E10. Circle through three points: one regression on center-radius form
- Category: regression · `three-point-regression` (or `expanded-circle`) ·
  Lib: #18 covers quadratics and #36 covers given equations. **Missing.**
- Trig: "a circle passes through (…), (…), (…)", asking for the center or
  radius.
- Alg: intersect perpendicular bisectors, or notice a right angle and use
  Thales' theorem (a one-off fact).
- Desmos: fit (x-h)²+(y-k)² ~ q to the three points; q stands for r², which
  avoids fitting a sign for r.
- Why: no bisectors, no system, no Thales.
- Prim: lists (W), regression (W).
- Not when: the three points are collinear, so no circle exists. Desmos does
  NOT fail visibly here. For (1,1), (2,2), (3,3) it returns a huge,
  meaningless circle (h≈-248, k≈252, √q≈354; verified), so check for
  collinearity before trusting the fit. The question may also supply the
  center, which makes this plain `distance()`.
- Ex: *A circle passes through (1,2), (7,2) and (1,10). What is its radius?*
  Answer **5**, center (4,6).
  ```
  x_{1}=[1,7,1]
  y_{1}=[2,2,10]
  (x_{1}-h)^{2}+(y_{1}-k)^{2}\sim q
  \sqrt{q}
  ```
  Exactly determined: three conditions, three parameters, one solution
  (checked). Desmos returns h=4, k=6, q=25 and √q=5 (verified).

### E11. Type transformations in function notation and read the result
- Category: built-in · `function-evaluation` (then `vertex-read`) · Lib: #25
  (composition), #39 (absolute-value vertex). **Weak.** Transformations such
  as g(x)=f(x+3)-5 are never written out.
- Trig: g is defined from f by a shift, reflection or stretch (f(x+3),
  -f(x), 2f(x)-1), asking about g's vertex, intercept, value or graph.
- Alg: apply the shift rules ("x+3 moves LEFT"), a classic sign error.
- Desmos: define f as given, define g exactly as written, graph g, and click
  the feature.
- Why: no shift-direction rules and no re-expansion.
- Prim: functions (W), vertex click (W).
- Not when: the question shows f only as a graph, with no equation. Read the
  points, then fit (#14/#18) before defining g.
- Ex: *f(x)=x²-8x+12 and g(x)=f(x+3)-5. What is the minimum value of g?*
  Answer **-9**, at x=1.
  ```
  f(x)=x^{2}-8x+12
  g(x)=f(x+3)-5
  ```
  Click g's vertex at (1,-9) (checked: g(x)=x²-2x-8; Desmos gives g(1)=-9).

### E12. A degree-measure trig equation: a restricted graph instead of the cofunction rule
- Category: intersection · `graph-both-sides` · Lib: #53–55. **Missing.**
  The library evaluates trig only.
- Trig: sin(expression in k)° = cos(expression in k)°, or similar, often with
  "acute" or a stated range.
- Alg: the cofunction identity A+B=90 (a one-off fact), then a linear equation.
- Desmos: degree mode, which is the SAT build's default (Desmos testing PDF)
  and the embedded calculator's. Rename k to x, graph each side, and restrict
  to the stated range. Read the x of the intersection.
- Why: no cofunction identity and no hand equation.
- Prim: graphing (W), restrictions (W).
- Not when: there is no range stated. A periodic equation has many
  intersections, and the restriction is mandatory, not decoration. Check the
  angle mode: desmos.com defaults to radians.
- Ex: *sin((2k+10)°) = cos((3k-5)°), and both angles are acute. What is k?*
  Answer **17**.
  ```
  y=\sin(2x+10)\left\{0<2x+10<90\right\}\left\{0<3x-5<90\right\}
  y=\cos(3x-5)
  ```
  One intersection, at x=17 (checked exactly: both solution families of
  sin A = cos B give only k=17 in range). Desmos labels it (17, 0.69466)
  (verified). It lies outside the default ±10 window, so set the window to
  the stated range first.

### E13. Slope of the tangent to a circle: graph each candidate line and find the one that touches once
- Category: answer-choice · `graph-each-choice`. Without choices, use
  `derivative-slope` on the half-circle · Lib: #33/#34 cover lines only, and
  #71 covers functions only. **Missing** for circles.
- Trig: "line ℓ is tangent to the circle at (p,q)", asking for its slope or
  equation.
- Alg: radius slope, then the negative reciprocal. That is two facts: the
  tangent is perpendicular to the radius, and the slope formula.
- Desmos (choices): graph the circle and each choice as its own row. The
  tangent shows one intersection; the others cross twice.
  Desmos (student-produced response): write the half of the circle containing
  the point as a function, then evaluate f′ at p. Solving for y costs about
  2 derivation steps.
- Why: no perpendicular-radius fact and no slope formula.
- Prim: graphing (W); y-3=m(x-5) is point-slope form, which is a small fact.
- Not when: the slopes of two choices are close. A near-tangent line visibly
  "touches" too; compare the intersection points it labels. Use separate
  rows, not one list row, because list members share a color.
- Ex: *A line is tangent to (x-2)²+(y+1)²=25 at (5,3). What is its slope?
  A) -3/4 B) 3/4 C) -4/3 D) 4/3.* Answer **-3/4**.
  ```
  (x-2)^{2}+(y+1)^{2}=25
  y-3=-\frac{3}{4}(x-5)
  y-3=\frac{3}{4}(x-5)
  y-3=-\frac{4}{3}(x-5)
  y-3=\frac{4}{3}(x-5)
  ```
  Only the first line meets the circle once (checked: distinct intersection
  counts 1, 2, 2, 2; the screenshot agrees). Student-produced-response route:
  `f(x)=-1+\sqrt{25-(x-2)^{2}}` then `f'(5)` gives -0.75 (verified). The
  app colors rows from a 4-color cycle (`EXPRESSION_COLORS` in
  `src/lib/desmos-preflight.ts`), so row 5 shares row 1's color. Students
  should identify choices by row, not by color.

### E14. Point-in-region with a numeric check near a boundary
- Category: visual + list · `graph-inequality` (numeric version
  `list-evaluation`) · Lib: #27–29. **Adequate, with one gap.** A point on a
  dashed (strict) boundary looks like it is inside the region.
- Trig: "which point is in the solution set".
- Alg: substitute each point into each inequality.
- Desmos: shade both inequalities and plot the choices. If any point lies on
  or near a boundary line, compute each inequality's margin as a list. A
  choice wins only if every margin is positive.
- Prim: inequalities (W), lists (W).
- Ex: *Which point satisfies y > 2x-3 and x+y < 4? (3,2), (-1,4), (2,3),
  (0,-4).* Answer **(-1,4)**.
  ```
  y>2x-3
  x+y<4
  X=[3,-1,2,0]
  Y=[2,4,3,-4]
  (X,Y)
  Y-(2X-3)
  4-(X+Y)
  ```
  The draft omitted the `(X,Y)` row, but the plan says to plot the choices,
  so it was added. The outputs [-1,9,2,-1] and [-1,1,-1,8] are both positive
  only in position 2 (verified). The point (2,1) would sit exactly on the dashed line: its margin is 0, so
  it is rejected (checked).

### E15. Sum or product of irrational roots: prefer a fitted readout to retyping clicked decimals
- Category: regression · `parameter-regression` (fits the factored form) ·
  Lib: #9 says "click x-intercepts" and #18. **Weak.** The library never
  says that arithmetic on clicked values is approximate. In Desmos 1.11.4 the
  labels carry 5 decimals, so the drift is small but not zero.
- Trig: "the product / sum of the solutions", "the difference of the roots",
  when the roots are irrational.
- Alg: Vieta's formulas (c/a, -b/a), which are one-off facts.
- Desmos: fit the factored form with the leading coefficient given. a and b
  are the roots; read `ab` or `a+b`. Swapping a and b gives the same
  sum and product, so the requested quantity is identifiable even though the
  order is not. A regression returns one value per parameter (verified:
  `p^{2}-3p\sim10` returns only p=-2), which is why the roots need two
  separate parameters here. The draft credited 1600.io for this; per a
  search summary, 1600.io's lecture instead teaches recovering both roots by
  regression.
- Why: no Vieta, an exact readout, and no retyping of long decimals.
- Prim: lists (W), regression (W).
- Not when: the roots are rational and the clicked values are exact. Then
  click and add (#9). Clicking and multiplying is also an acceptable
  alternative: with 5-decimal labels it gives the right answer after an
  obvious rounding.
- Ex: *What is the product of the solutions of 2x²-7x+2=0?* Answer **1**.
  **Corrected:** the draft assumed 4-decimal labels (0.3139 × 3.1861 =
  1.0001). Desmos 1.11.4 actually labels the zeros 0.31386 and 3.18614
  (verified at both the ±10 and ±50 windows). Retyped, they multiply to
  1.0000019, which is close to 1 but not exact. So the gain here is
  exactness, not rescuing a wrong answer.
  ```
  x_{1}=[1,2,3]
  2x_{1}^{2}-7x_{1}+2\sim2(x_{1}-a)(x_{1}-b)
  ab
  ```
  The last row reads 1, and `a+b` reads 3.5 (checked, both branches;
  verified in Desmos: a=3.18614…, b=0.31386…, ab=1).

### E16. Linear or exponential? Fit the table and compare
- Category: regression/list · `exponential-regression` or `linear-regression`
  · Lib: #14, #41. **Adequate, but recognition is missing.** The library says
  "use when data follows exponential growth" without saying how to tell.
- Trig: a table of values, "which function / which type models".
- Alg: compute successive differences and ratios by hand.
- Desmos: enter the table and fit the model whose choices remain. R²=1 (or
  r²=1) identifies it. Alternatively, the ratio list is constant for an
  exponential.
- Prim: lists (W), regression (W).
- Not when: the data is real-world and noisy ("best fit"). Then compare R²
  values; neither is 1. The Bluebook build turns log mode on by default
  where it applies to exponential fits (S). The draft said this "fails for
  zero or negative y", which is unsupported: the summary says log mode is
  applied only where applicable. On noisy data a log-mode fit gives slightly
  different a, b and R² than ordinary least squares. On exact data like the
  example both give a=6, b=1.5.
- Ex: *x: 0,1,2,3; y: 6, 9, 13.5, 20.25. Which models the table? A)
  y=6(1.5)^x B) y=3x+6 C) y=6+1.5x D) y=6(3)^x.* Answer **A**.
  ```
  x_{1}=[0,1,2,3]
  y_{1}=[6,9,13.5,20.25]
  y_{1}\sim ab^{x_{1}}
  ```
  The fit gives a=6, b=1.5, R²=1. `\frac{y_{1}[2...4]}{y_{1}[1...3]}` reads
  [1.5,1.5,1.5] (both verified in Desmos).

### E17. Remainder or quotient by identity regression
- Category: regression · `identity-regression` · Lib: #60 (mentions
  "rewritten rational") and #72 (factorization). **Missing** for division and
  remainders.
- Trig: "the remainder when p(x) is divided by x-c", "p(x)/(x-c) = q(x) +
  r/(x-c), find r or a coefficient of q".
- Alg: synthetic or long division. Alternatively the remainder theorem p(c)
  (a one-off fact, cost 4).
- Desmos: fit p(x₁) ~ (x₁-c)(generic quotient) + r on at least degree+1
  inputs. Read r and the quotient coefficients.
- Why: no division algorithm and no remainder theorem.
- Prim: lists (W), regression (W).
- Not when: only the remainder is wanted AND the student already knows the
  remainder theorem. Then `p(c)` is 2 rows, but it costs the fact; list it as
  the alternative. Avoid sample x=c only for rational forms. For a polynomial
  identity, any degree+1 distinct inputs work (4 here; `[1...5]` gives five).
- Ex: *What is the remainder when x³-2x²+5 is divided by x-3?* Answer **14**
  (quotient x²+x+3).
  ```
  x_{1}=[1...5]
  x_{1}^{3}-2x_{1}^{2}+5\sim(x_{1}-3)(ax_{1}^{2}+bx_{1}+c)+r
  ```
  Unique fit a=1, b=1, c=3, r=14 (checked; Desmos returns the same).

### E18. "Tilde-solve": any single equation in a non-x letter, with a restriction to pick the branch
- Category: regression · `parameter-regression` · Lib: #17. **Weak.** It is
  framed as "a point and an unknown constant" with one-element lists. Scott
  Robinson teaches it generally: swap "=" for "~" and read the letter (S).
  The library never states the branch problem or the restriction fix.
- Trig: one equation, one unknown named anything except x or y. Percent
  chains, rates and formulas solved "for p".
- Alg: isolate the unknown by inverse operations.
- Desmos: type the equation with "~" in place of "=" and read the parameter.
  No list is needed: `1.2\left(1-\frac{p}{100}\right)\sim1.04` runs and fits
  p (verified). Regression returns ONE value even when two exist (verified:
  `p^{2}-3p\sim10` returns only -2; the draft's 1600.io attribution was
  dropped, see (a)). Add a parameter restriction for the branch the question
  asks for. Desmos documents `{1<b<5}`-style restrictions on regression
  parameters, and `\left\{p>0\right\}` returns 5 (verified).
- Why: no rearranging, and no renaming to x.
- Prim: regression (W), restriction (W).
- Not when: the unknown is x or y. Desmos rejects it ("'x' may not be used
  as a regression parameter", verified); rename it or use E1. Do not use it
  when both roots are asked for: graph (#3/#9) or factor-fit (E15). For a
  NONLINEAR fit whose true value is very large, the initial guesses may miss
  it, so rescale the units (Desmos help, (S); the ±5000 figure is
  unconfirmed). A fit linear in the parameter, like the percent example, is
  solved exactly at any scale.
- Ex: *A price is raised 20% and then lowered p%; the final price is 4% above
  the original. What is p?* Answer **40/3 ≈ 13.33**.
  ```
  1.2\left(1-\frac{p}{100}\right)\sim1.04
  ```
  The fit reads p=13.3333 (verified). Branch example: *p²-3p=10 and p>0;
  what is p?* Answer **5**:
  ```
  p^{2}-3p\sim10\left\{p>0\right\}
  ```
  Verified: 5 with the restriction, and -2 without it.

### E19. A no-solution parameter that is not a "nice" number: a slider cannot land on it
- Category: slider (failure mode) and answer-choice · `slider-parallel` and
  `graph-each-choice` · Lib: #61 (slider-parallel) and solver instructions
  ("drag until parallel"). **Contradicts in practice.** Nothing requires the
  answer to be reachable on the slider's step grid.
- Trig: "for what k does the system have no solution", where k works out to
  a fraction such as -6/7.
- Alg: proportional coefficients, k/2 = 3/(-7) ≠ 7/4. This is a one-off fact.
- Desmos (choices): graph the fixed line and one row per choice. The parallel
  choice is the only line with NO intersection point, provided the window is
  wide. A near-parallel distractor can meet the fixed line far off-screen:
  k=-7/6 meets it at (-28.2,-8.6). Zoom out before concluding.
  Desmos (student-produced response): a slider only brackets the answer. The
  intersection jumps from (-203,-59) at k=-0.9 to (152,43) at k=-0.8, and no
  slider stop on a decimal grid is the answer. Make it exact with the
  coefficient-ratio fit `\frac{k}{2}\sim\frac{3}{-7}`, which costs one fact
  (Desmos returns k=-0.857142857, verified; the student-produced response
  accepts -6/7 or -.8571). Or use the library's
  derivative regression after writing each line as a function (about 2
  derivation steps).
- Not when: the parameter is an integer or a simple decimal on the grid.
  Then the slider is the best method.
- Ex: *For what value of k does kx+3y=7, 2x-7y=4 have no solution? A) -6/7
  B) 6/7 C) -7/6 D) 7/6.* Answer **-6/7**.
  ```
  2x-7y=4
  -\frac{6}{7}x+3y=7
  \frac{6}{7}x+3y=7
  -\frac{7}{6}x+3y=7
  \frac{7}{6}x+3y=7
  ```
  Only row 2 never meets row 1. Its constants differ (7/3 versus -4/7 as
  y-intercepts), so the lines are separate, not coincident (checked; all
  five rows run in Desmos). With the app's 4-color cycle, row 5 shares row
  1's color, so name the choices by row.

### Coverage notes (techniques tutors teach that the library already handles)
Adequate as written: graph both sides (#1, #3, #5), counting intersections
(#8, #13), vertex clicking (#10), restricted extrema (#12), regression from
data (#14–16), identity regression with unknown constants (#59; Scott uses
random sample lists, the library uses deterministic ones, which suits
caching), bracket regression for systems (#61, which matches the r/Sat thread's
"left sides in one list" description), the shared zero (#75), and the vertex
of the difference (#76).

---

## (c) Routing heuristics

1. **Name the unknown before choosing a tool.** If the unknown is x, use E1
   (vertical lines) to count and locate the solutions. Its lines are labelled
   only for polynomial equations of degree at most 2, so use #3 for a
   labelled value otherwise. If it is another letter and only one value is
   wanted, use E18 (tilde-solve). If it is another letter and all values are
   wanted, rename it to x and use E1 or #3. If the unknown is x or y inside a
   regression, rename it: Desmos rejects x and y as regression parameters
   (verified).
2. **"All / sum / how many solutions" means graph; "the positive one" means
   graph, or tilde with a restriction.** Regression silently returns one
   branch (verified: `p^{2}-3p\sim10` gives only -2).
3. **Answers that do not depend on a parameter mean setting a value (E5).**
   Test this before any symbolic route: drag the parameter once. If the
   answer stays put, the method is done.
4. **Parameter plus a visual condition means checking the grid.** Use a
   slider when the answer is an integer or sits on a simple grid, and the
   condition is visible (touches, parallel, shares an intercept). Use
   regression, vertex of the difference (#76), or a choice-per-row graph when
   the value is a fraction such as -6/7 (E19).
5. **Choices that are numbers: list test (#20). Choices that are
   expressions: strategic value or overlay (E4, #74). No choices (student-
   produced response): the general technique.** Identity regression (#60) is
   for unknown constants, not for checking four fully numeric choices.
6. **Visual list graphs need a discriminator.** One row with a list of
   choices draws every member in one color (verified). When the student must
   know WHICH member has the feature, use separate rows (E13, E19) or add a
   numeric list row. The app cycles 4 row colors, so identify rows by
   position, not color.
7. **Prefer rows or parameters to retyped clicked decimals when exactness
   matters.** Labels carry 5 decimals in Desmos 1.11.4 (verified), so drift
   is small (E15: 1.0000019 instead of 1). It grows under powers and
   reciprocals, and it never yields an exact form. Radicals and fractions
   among the choices are matched with a list of the choices' decimals (E8).
   A student-produced response takes a decimal that fills the box (5
   characters, 6 if negative), rounded or truncated, so a clicked value is
   fine when it IS the answer.
8. **Geometry with lengths and no coordinates: build it on the axes when
   that removes an off-sheet formula** (Heron, law of cosines, Thales: E9,
   E10). Otherwise use the reference sheet.
9. **Circles in general form: click the top and bottom (E3) first** (labelled
   in Desmos 1.11.4, verified). Use the 3-sample regression only for an exact
   r² or when the clicks are unavailable.
10. **Trig in degrees: confirm the mode; restrict periodic graphs to the
    stated range (E12).** The SAT build defaults to degrees; desmos.com
    defaults to radians.
11. **Rational expressions: holes are invisible** (verified). For "undefined
    at" or "excluded value", graph the denominator and click its zeros, never
    an overlay. (#73 covers the same fact as the regression condition
    denominator(k)=0. The draft cited #73 for "graph the denominator", which
    it does not say.)
12. **Data in the thousands or millions: rescale before a nonlinear
    regression** (Desmos help, (S); the ±5000 initial-guess span is
    unconfirmed). A fitted parameter near a bound, or an oddly large RMSE,
    signals a local minimum.
13. **The "% of" operator exists.** `p\%\operatorname{of}20\sim9` fits p=45
    (per Acely and the Desmos blog; verified in Desmos 1.11.4). Scott reports
    a quirk with it (S), so rows should use the multiplier form
    `\frac{p}{100}`, which always parses.
14. **Representation questions stay translation-only.** No tutor source
    contradicts the existing policy.

---

## (d) Scoring insights

1. **Typing, not rows, is the real cost on test day.** Bluebook students
   cannot paste the question into Desmos (SayHelloCollege, (S)), and the
   keypad is alphabetical. A 60-character row costs much more than a
   `\sqrt{q}` row, and retyping four long choices (an overlay) is slow. The
   cost model counts each row as 1 regardless of length. Charge long rows
   more, and charge repeated long subexpressions each time they are typed.
2. **"Build more than you'd write" is the tutor test for over-engineering**
   (OnePrep; the quote is unconfirmed, see (a)). By that test, these library defaults are the ones tutors would
   call student-hostile:
   - the eight-row derivative-regression example in #61, which freezes and
     copies a fitted line;
   - the signed-divisor `join`/`mod`/`for` enumeration in #72;
   - the 6-sample circle fit in #36;
   - the midpoint-of-a-diameter construction in #36's "find n" example.
   Each is fine as a listed alternative, but none should win the default
   against a 1–3 row graph read.
3. **Sliders are mainstream, but only on a grid.** Tutors widely recommend
   sliders for no / one / infinitely many solutions. Desmo's cost model
   counts the drag as one manual iteration, which is fair. It never checks
   that the answer is reachable on the slider's step grid (E19). A slider
   whose answer is off-grid cannot produce the answer and must not be
   accepted as the method.
4. **Regression is "too clever" when the graph already shows the answer.**
   The library agrees (#1 preference examples): keep regression out of the
   default whenever clicking points suffices. The draft said "1600.io
   prefers graphing for both roots". A search summary of that lecture says
   the opposite for exact forms: it keeps graphing as the default but uses
   regression to get both roots exactly when the graph's decimals cannot.
5. **Hand work is genuinely faster for one clean step** ("under 20–30
   seconds": Vibrant Publishers and OnePrep, (S)). Desmo's philosophy
   deliberately still prefers graphing 3x=18. That is a product choice, not
   an error, but it means the written technique must stay listed for such
   problems, which it already is.
6. **Precision and readability belong in reliability scoring.** A visual read
   that cannot tell list members apart (E13, E19) should rank below an
   equivalent method that ends in a parameter or list readout. So should a
   vertical line from a non-polynomial one-variable equation, which carries
   no label (E1, E6). Arithmetic on clicked decimals (E15) is a weaker
   penalty: the 5-decimal labels keep it close.
7. **Unwhitelisted list machinery is underpriced.** `for` comprehensions,
   `join` and multi-stage filters are not on the primitive whitelist, but
   the cost model's new-primitive list names only
   polygon/repeat/mod/gcd/lcm/sum/ceil/floor/distance/midpoint/inverse trig.
   Comprehensions should count as a new primitive.
8. **Test-day transfer risk.** The SAT build turns log mode on for
   exponential regressions and lacks sec/csc/cot. The library never uses
   those, which is good. Availability of `repeat()`, `distance()` and
   `midpoint()` in Bluebook is plausible but unconfirmed (f). The SAT config
   summary did not list them as disabled; a state config did.

---

## (e) Prioritized recommendations

Each item is tagged with the library strategy number, or NEW.

**P1: high value, low risk**
1. **[NEW under #2/#3, `graph-raw`]** Add "Type a one-variable equation as
   written" (E1): vertical lines at the solutions, the rename-to-x rule, and
   zooming out before concluding "no solution". Fold in one-variable
   inequalities (a shaded band) and the one-row statistic equation (E6).
2. **[#44 vs routing, `desmos-tricks.md` line 44]** Fix the contradiction:
   line 44 says "List the 2–4 genuinely distinct techniques", while the
   routing section (line 1689), `solver-instructions.ts` and PHILOSOPHY.md all
   say "up to six". Change line 44 to "every technique that validly solves
   it, up to six".
3. **[#36]** Trim the expanded-circle regression to 3 non-collinear samples
   (E3 shows a unique fit). Add the top/bottom-click method as the
   first-listed candidate once a Desmos run confirms the points are labelled.
4. **[#60]** State that "which expression is equivalent" with fully numeric
   choices routes to strategic-value testing or an overlay (E4). Identity
   regression is for unknown constants. Add the holes caveat.
5. **[#57, slider-parallel, solver-instructions INTEGER PARAMETERS /
   VISUAL AND SLIDER ENDINGS]** Add a grid rule: a slider method is valid only
   if the answer lies on min + n·step. Otherwise list a choice-per-row graph
   or an exact regression (E19). The server can check
   `answerState.value` against the slider field.
6. **[RELIABILITY, #9, #18]** Add: "never multiply, divide or power clicked
   decimals; fit the factored form or compute in a row" (E15). Also add
   "match radical or fraction choices by listing their decimals" (E8, under
   #49).
7. **[#57, #61, solver-instructions "Parallel/no-solution" pattern]** A graph
   row that broadcasts a list of choices draws every member in one color.
   Require a numeric discriminator row, or one row per choice, whenever the
   student must identify which choice shows the feature. The current
   "the overlapping choice is the impossible one" instruction gives the
   student no way to tell which one that is.
8. **[#17]** Generalize parameter regression into "tilde-solve" (E18). Cover
   any single equation in a non-x letter, the one-branch warning, and the
   `{p>0}` restriction to choose a branch. Note that x and y cannot be fitted.

**P2: new strategies that fill clear gaps**
9. **[NEW, near #74]** Nuisance constant: set any legal value and drag once
   to show the answer is unchanged (E5).
10. **[NEW, near #45–48]** Graph a statistic as a function of the unknown
    (E6). Mention that it finds every case at once.
11. **[#16/#41]** Rate over a different period: f(1)/f(0), or f(1/12)/f(0)
    for monthly (E7).
12. **[NEW, near #68]** Construct a triangle from its side lengths with two
    circles (E9).
13. **[NEW, near #36/#18]** Circle through three points (E10).
14. **[#25]** Transformations typed in function notation (E11).
15. **[NEW, near #53–55]** Degree-mode trig equations via restricted graphs;
    mandatory range restriction (E12).
16. **[NEW, near #33/#34/#71]** Tangent to a circle: one row per choice, or
    the half-circle derivative for student-produced responses (E13).
17. **[#72/#60]** Remainder or quotient by identity regression (E17).
18. **[#3]** Extraneous-root trigger (E2). **[#29]** Boundary margin lists
    (E14). **[#41]** Model-type recognition by fit (E16).

**P3: scoring and safety**
19. **[method-scoring]** Add a typing-length surcharge (for example +1 per 40
    characters beyond the first 40 in a row). Count retyped long
    subexpressions each time.
20. **[method-scoring]** Count `for` comprehensions, `join` and chained
    filters as a new primitive. Count copying a fitted equation into a new
    row ("freezing") as a manual iteration.
21. **[REGRESSION SAFETY]** Add rescaling (the ±5000 initial-guess range),
    parameter restrictions as a branch selector (not a constraint), and
    log-mode awareness for exponential fits.
22. **[#61, #72, #36]** Demote the multi-stage constructions to alternatives
    when a 1–3 row graph read exists (d.2).
23. **[#12 vs line 64]** Reconcile the endpoint rule. #12 says always add
    f(a) and f(b) rows; the preference example says add them only if an
    endpoint could win. Keep the latter.
24. **[#66, #49, #50]** Before shipping more lessons built on `repeat()`,
    `distance()` or `midpoint()`, confirm they exist in the Bluebook build.
    Keep a fallback in each strategy: `\operatorname{total}(VF)/\operatorname{total}(F)`
    for repeat, and the Pythagorean form or averages for distance and
    midpoint.

**Benchmark seeds (case-schema field values; all problems original)**

| Ex | domain | expectedResultType | gold | acceptable | bad (why) | routing flags |
|---|---|---|---|---|---|---|
| E1 | Advanced Math | x_intercept | graph-raw | graph-both-sides, intercept-read | quadratic-formula (needs cross-multiplying first) | none |
| E3 | Geometry and Trigonometry | vertex | graph-raw | expanded-circle | completing-the-square (hand algebra the click avoids) | none |
| E4 | Advanced Math | list_entry | strategic-value-test | graph-each-choice, identity-regression | factoring (4 hand steps) | none |
| E5 | Advanced Math | vertex | vertex-read | strategic-value-test | completing-the-square (expands a nuisance constant) | none |
| E6 | Problem-Solving and Data Analysis | x_intercept | statistics-builtin | graph-both-sides | direct-arithmetic (case analysis misses roots) | none |
| E7 | Advanced Math | numeric | function-evaluation | strategic-value-test | direct-arithmetic (exponent laws hidden) | none |
| E9 | Geometry and Trigonometry | intersection | graph-both-sides | polygon-area | reference-formula (Heron is not on the sheet) | none |
| E15 | Advanced Math | numeric | parameter-regression | intercept-read | quadratic-formula (radical product by hand) | none |
| E17 | Advanced Math | numeric | identity-regression | function-evaluation | direct-arithmetic (long division) | none |
| E19 | Algebra | visual_choice | graph-each-choice | slider-parallel, derivative-regression | elimination (coefficient-ratio fact) | condition: no-solution |

(E19 marks `slider-parallel` acceptable only because the choices give a
grid; for the student-produced-response version, mark it bad with the reason
"answer is not on any slider grid".)

---

## (f) Claims I could not verify

1. **Every source claim marked (S).** I read search-engine summaries, not
   the pages. In particular, the exact content of Scott Robinson's guide,
   Masterclass and videos is unverified. His "% of" workaround and the
   "Broken Desmos Method" video are known only by title or caption.
2. **Circle points of interest (E3).** That Desmos labels a circle's top and
   bottom points (but not left and right) comes from one forum summary. It
   must be checked in the embedded calculator and in Bluebook before E3
   ships as a default.
3. **Vertical-line reading (E1, E6).** I could not confirm that clicking a
   vertical line from a one-variable equation shows a labelled x-axis point,
   or that `median([...,x])` graphs as a function of x. Several tutor
   sources describe the method; the click behavior is unconfirmed.
4. **No row in this document was executed in Desmos** (no Chrome here).
   The checks are mathematical: sympy solutions, uniqueness of every
   regression's solution set at the given samples, and an exact scan for E6
   and E12. Optimizer convergence (E10, E15, E18) is assumed, not observed.
   Run them through `scripts/check-desmos-preflight.mts`.
5. **Regression parameter restriction syntax** (`p^{2}-3p\sim10\left\{p>0\right\}`)
   follows the Desmos help summary (`{1<b<5}`). The app's preflight engine
   may treat it differently.
6. **Bluebook feature set.** `repeat()` is a documented Desmos function, but
   whether the SAT build enables it is unconfirmed. `distance()` and
   `midpoint()` appear available on the SAT; the "disabled" list I saw may
   belong to a state assessment config. Log mode defaulting ON for
   regressions is from the testing-calculator summary.
7. **"You cannot paste the question into Desmos in Bluebook"** is from a
   single tutor blog.
8. **Library #68's claim that Desmos displays a polygon's area** was not
   checked. E9 deliberately reads the height and uses ½bh instead.
9. The proxy-status endpoint was not consulted (the action was refused), so
   I do not know whether the blocked domains can be allowed for a rerun.
