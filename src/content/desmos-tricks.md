DESMO SAT MATH STRATEGY LIBRARY

DESMOS-FIRST, LEAST-TOTAL-EFFORT POLICY

Desmo teaches Desmos-first problem solving, not traditional math with Desmos
added afterward. The student may be weak at traditional math but strong at
recognizing Desmos patterns; their thought should become "this is an
intersection trick", "this is a list-filter trick", "this is a midpoint
trick", never "I need to derive this formula and then use Desmos to calculate
it". Every solution therefore names its trick.

THE REQUIRED ORDER: recognize the problem's structure → search this library
for Desmos-native techniques that fit it → generate Desmos-first candidates →
select the method requiring the least student math while staying reasonably
simple → verify with symbolic math internally → show only the Desmos-first
solution. Never solve traditionally first and reverse-engineer a
Desmos-looking plan around that answer; typing a derived result into the
calculator is not a Desmos method. Internal algebra may confirm the Desmos
answer, never dictate the student-facing method.

GENERALIZABLE OVER ANSWER-CHOICE-ONLY: when a reusable technique also solves
the question without the answer choices and is reasonably simple, prefer it
over plugging the choices in; it transfers to the next problem and to
student-produced responses. Answer-choice testing stays a strong candidate
when it is clearly simpler or the general route is convoluted.

Obtain the correct answer with the least total student effort: the shortest,
clearest Desmos workflow an elite SAT/Desmos tutor would actually use under
time pressure and a student could reproduce. Desmos outsourcing is valuable
only when it simplifies the overall workflow. Rows are cheap but not free:
prefer 1–4 rows; use 5–6 only when they clearly simplify a hard problem; more
than 6 needs strong justification. A plan needs no final numeric row when the
student can read an intersection, zero, vertex, overlap, or slider condition
directly from the graph.

Penalize HIDDEN DERIVATION above all. A short expression is not simple if the
student first had to derive a non-obvious formula to type it: B=(M-7)/6 is one
row but needs factor-theorem algebra, so a three-row slider or shared-zero
graph that needs no derivation beats it. Also penalize unnecessary intermediate
variables, unnecessary lists, duplicated rows, overcomplicated regressions,
numeric checks of what the graph already shows, and rows added only for
automation. Advanced tricks earn their place only when they materially simplify.

List the 2–4 genuinely distinct techniques that solve the problem, each named
by the [technique: id | name] tag of the strategy that teaches it, and report
each one's cost components honestly. The server scores them; the lowest total
cost is the default, and the student may switch to any other listed technique.
Always include the lowest simplicity-ladder rung that works, and a paper
technique when one genuinely exists. Never pad the list with a technique that
does not solve the problem: two real techniques beat four with filler. Before
choosing, ask "what is the shortest,
clearest Desmos workflow a student could realistically reproduce?", never "how
can Desmos perform every individual mathematical step?". An invalid or
unjustified method is never listed.

PREFERENCE EXAMPLES (the simplest valid applicable method wins):
- Factor problem, b a positive integer: a one-row derived formula such as
  B=(M-7)/6 hides factor-theorem algebra. Preferred: b=1 as an integer slider,
  y=x+2b, y=3x^2+25x+14b; drag b until the line and the parabola share an
  x-intercept (b=3). Three rows, nothing derived.
- Where do y=x^2-4x+1 and y=2x+8 meet? Preferred: enter both, click the
  intersection (7,22). Not preferred: A=[5,6,7,8], f(x)=..., g(x)=..., f(A)-g(A)
  to compare the same two sides through a list; the graph already shows it.
- Minimum of f on 0≤x≤5: preferred y=f(x)\left\{0\le x\le5\right\} and
  click the lowest point (add f(0) and f(5) only if an endpoint could win). Not
  preferred: X=[0...5] and f(X) sampled into a list, which can miss the true
  extremum and adds reading work.
- Unknown constant from one point: y_{1}~a(x_{1}-3)^2+5 with one-element lists
  is fine, but a=1 as a slider with the point plotted is simpler when the
  student can see the curve pass through the point; use regression when the
  value must be exact or several constants are unknown.

CONDITION TRANSLATION comes first: before coefficient matching, expansion,
elimination, factoring, polynomial division, completing the square, slope
manipulation, percent-growth formulas, or symbolic rearrangement, ask whether
the givens convert directly into numerical conditions Desmos can solve. A root
at x=k is f(k)=0; a point (p,q) is f(p)=q; an x-intercept is f(k)=0 and a
y-intercept is f(0)=value; a hole or vertical asymptote is denominator(k)=0;
equal outputs are f(a)=f(b); a factor x+kb is a shared zero at x=-kb; two
equivalent expressions are an identity regression; several equations are one
list/vector regression; answer choices are a list to evaluate; integer
possibilities are a justified filtered list; a bounded domain is a restricted
graph or extremum; a symbolic multiple-choice answer is strategic-value
testing. Prefer this route whenever it materially reduces the mathematical
knowledge the student must supply (strategies 59–61 and 72–75).

Consider relevant advanced methods before formula-based shortcuts: regression,
parameter regression, derivative regression, lists/tables, intersections, zeros,
answer-choice testing, implicit graphing, restrictions, and function evaluation.
Do not treat putting manually derived numbers into Desmos as meaningful
outsourcing. Numeric expressions remain useful when they calculate directly
from givens without requiring the student to derive the solution first.

REPRESENTATION POLICY: If the question asks which equation or expression
represents/models a situation, prefer direct conceptual translation. The target
is the model, not its solution. Once the quantities and relationship match a
choice, stop. Graphing or solving the selected equation afterward is irrelevant
calculator work and receives no Desmos-outsourcing credit. Use Desmos only when
it materially reduces the reasoning required to identify the model itself.
Matching an equation to a supplied graph, table, or numeric behavior is a
different case; graphing/evaluation may materially distinguish those choices.

FORMULA POLICY: A formula printed in the question or on the SAT reference sheet
is available to the student and is not a memorization burden. The reference sheet
includes circle area/circumference, rectangle and triangle area, the Pythagorean
theorem, 30-60-90 and 45-45-90 triangles, rectangular-prism/cylinder/sphere/
cone/pyramid volumes, 360 degrees = 2π radians, and a triangle's 180-degree angle
sum. Directly substituting the givens into one of these formulas in Desmos is a
strong method. A small set of core SAT relationships such as SOHCAHTOA can also
be reasonable when it is the natural one-step model. Treat an unprovided niche
formula as human math knowledge. Prefer a graph, regression, list, built-in
function, or original-equation setup when it avoids recalling or deriving one.

VISUAL RESULTS ARE VALID ENDINGS: the best strategy may end with a graphical
condition instead of a scalar row: an intersection to click, a zero, a vertex,
overlapping graphs, tangency, a shaded region, a slider position, or the one
answer-choice graph with the required feature. "Click the intersection and
read x=7" is a complete final instruction. Do not add calculation rows only to
force a numeric ending, and do not convert a clear graph reading into algebra.

RELIABILITY: prefer exact clickable points (intersections, intercepts, vertices,
which Desmos labels with coordinates), regression outputs, list results, or an
unmistakable graph condition. Do not rely on eyeballing an approximate position
when precision matters; when two choices are close, add a numeric row that
distinguishes them.

Each listed technique is one canonical method: its ordered calculator
entries, their purposes, and the final answer instruction describe exactly
that method. The routing policy at the end applies across all 76 strategies.

1. Graph two equations and click the intersection
[technique: graph-both-sides | Graph both sides]

Use when: Two equations/functions are given and the question asks where they intersect, what x/y satisfies both, or for a solution to a system.

Example

y=x^2-4x+1
y=2x+8

Click the intersection.

Do NOT: Set them equal and solve manually when the two graph entries suffice.

Desmos automatically displays important points such as intersections.

2. Graph equations without isolating y
[technique: graph-raw | Graph as written]

This is huge.

Students waste time rearranging equations like:

3x+2y=17
x^2+y^2=25

Desmos can graph those exactly as written.

Use when: Equation contains both x and y.

Rule: Never waste time converting to y= unless it somehow makes the problem easier.

3. Solve an equation by graphing both sides
[technique: graph-both-sides | Graph both sides]

For:

x^2+4x+1=3x+7

Enter:

y=x^2+4x+1
y=3x+7

Then click intersection x-values.

This works for equations involving:

quadratics
radicals
absolute values
exponentials
rational expressions
complicated expressions
4. Solve by finding the x-intercept
[technique: intercept-read | Read the intercepts]

Alternative to #3.

For:

x^2+4x+1=3x+7

Enter:

y=x^2+4x+1-(3x+7)

Click the x-intercepts.

Use when the question already gives one expression equal to zero, gives a
function and asks for its zeros, or subtracting the two original sides can be
entered without simplifying. Prefer #3 when finding the single polynomial would
require distributing or combining terms by hand. Charge that hidden algebra to
the candidate even when the simplified result is typed into Desmos.

SYSTEMS
5. Linear system → graph both equations
[technique: graph-both-sides | Graph both sides]

Example:

2x+3y=17
5x-y=9

Enter both exactly.

Click intersection.

Usually faster than substitution/elimination.

6. Linear + quadratic system
[technique: graph-both-sides | Graph both sides]

Example:

y=x+4
y=x^2-2x-8

Graph both.

Click intersection(s).

Especially useful when question asks:

positive solution
larger x-coordinate
smaller y-coordinate
sum of intersection coordinates
7. Circle + line intersection
[technique: graph-both-sides | Graph both sides]

Example:

(x-3)^2+(y+2)^2=25
y=2x+1

Graph both directly.

Click intersections.

Don't expand the circle.

8. Number of solutions = number of intersections
[technique: count-intersections | Count the intersections]

Questions asking:

exactly one solution
two solutions
no solutions

Graph both.

Then count intersections.

Especially useful for:

quadratic + line
circle + line
absolute value + line
QUADRATICS
9. Find quadratic roots instantly
[technique: intercept-read | Read the intercepts]

If a quadratic function is given, enter it exactly:

y=ax^2+bx+c

Click x-intercepts. If the question gives two unsimplified sides of an equation,
graph both original sides and click their intersections instead of manually
building a standard-form quadratic.

Use for:

solutions
zeros
factors
positive/negative root
difference between roots
10. Find quadratic vertex instantly
[technique: vertex-read | Click the vertex]

Enter parabola.

Click the maximum/minimum point.

Use for:

maximum value
minimum value
vertex
axis of symmetry
greatest/least possible value

Example:

y=-2x^2+12x+7

Click vertex.

No completing the square.

11. Axis of symmetry from vertex
[technique: vertex-read | Click the vertex]

If vertex is:

(3,25)

then:

x=3

is the axis.

Do not calculate -b/(2a) if the graph is already there.

12. Maximum/minimum from graph, including bounded domains
[technique: restricted-extremum | Restricted-domain max/min]

Questions like:

What is the maximum value of f(x)?

Graph it and click the vertex/extremum.

Trigger: a function restricted to an interval such as a ≤ x ≤ b, "on the
interval", or "for 0 ≤ x ≤ 5", asking for the minimum, maximum, or range. Graph
the function WITH the restriction so Desmos shows only the relevant piece:

y=-2x^2+12x+7\left\{0\le x\le 5\right\}

Click the highest/lowest point of the restricted graph; also evaluate the
endpoints as rows, f(0) and f(5), so the extremum is read numerically rather
than estimated. For a monotonic exponential the endpoints are the extremes; for
any other function do NOT assume the extremum sits at an endpoint. If the
question asks which equation "displays, as a constant or coefficient" the
minimum or maximum, first determine the actual numerical extremum with Desmos,
then compare it with the constants visible in each choice. This replaces vertex
formulas, growth/decay reasoning, and endpoint arithmetic by hand.

13. Determine number of real roots visually
[technique: count-intersections | Count the intersections]

Graph:

y=f(x)

Count x-intercepts.

2 intersections → 2 real roots
1 → one repeated root
0 → no real roots
THE REGRESSION HACKS

This is where your tool can become much better than normal ChatGPT.

Desmos custom regressions use ~ instead of = and can estimate unknown parameters. Desmos officially supports custom regression models and stores the resulting parameter values for later calculations.

14. Linear regression from data
[technique: linear-regression | Linear regression]

Enter the supplied coordinates as paired lists:

x_{1}=[x-values]
y_{1}=[matching y-values]

Then:

y_{1} ~ mx_{1}+b

Desmos gives:

m=
b=

Use when question asks:

line of best fit
slope
intercept
prediction
15. Quadratic regression from three points
[technique: three-point-regression | Three-point regression]

Put the three coordinates in paired x_{1} and y_{1} lists.

Then:

y_{1} ~ ax_{1}^2+bx_{1}+c

Desmos gives a, b, and c.

This can completely destroy questions like:

A quadratic passes through these three points. What is a+b+c?

No system solving.

Desmos supports quadratic custom regression exactly this way.

16. Exponential regression
[technique: exponential-regression | Exponential regression]

Paired coordinate lists → then:

y_{1} ~ a(b)^x_{1}

Use when data follows exponential growth/decay.

Desmos gives:

a
b

If the question asks directly for a percentage rate, fit that requested
parameter instead of making the student convert the growth factor afterward:

y_{1}~a(1+p/100)^{x_{1}}

for p percent growth, or:

y_{1}~a(1-p/100)^{x_{1}}

for p percent decay. Read p under Regression Parameters. Use the a(b)^{x_{1}}
form when the growth or decay factor b itself is requested.
17. Unknown parameter regression
[technique: parameter-regression | Parameter regression]

Extremely useful.

Suppose a function contains an unknown constant:

y=a(x-3)^2+5

and you're given a point.

Put the supplied point in one-element paired lists, then:

y_{1}~a(x_{1}-3)^2+5

Desmos solves for a.

Avoid manual substitution and rearrangement when regression can determine the
parameter from the given data, even if the regression uses more entries.

Trigger: one unknown constant and one supplied fact. Any single condition is a
one-equation regression: a point (p,q) gives f(p)~q, a root at k gives f(k)~0,
a known output gives f(a)~value. Define f with the unknown left free, then
enter the condition with ~; Desmos fits the constant. Several such facts pack
into one regression (see 73).

18. Solve multiple unknown coefficients using regression
[technique: three-point-regression | Three-point regression]

Given three points and:

f(x)=ax^2+bx+c

Use:

y_{1}~ax_{1}^2+bx_{1}+c

You get all three parameters at once.

This is one of the highest-value SAT Desmos tricks. Trigger: three supplied
points and any question about the quadratic (a coefficient, a+b+c, the vertex,
f at another input). Evaluate follow-ups with the fitted parameters in later
rows; never rebuild the coefficient system by hand.

19. Regression on transformed equations
[technique: parameter-regression | Parameter regression]

You don't have to regress only basic equations.

Example:

y_{1}~a(x_{1}-h)^2+k

can find unknown vertex-form parameters when enough data exists.

Possible forms:

y_{1}~mx_{1}+b
y_{1}~ax_{1}^2+bx_{1}+c
y_{1}~a(x_{1}-h)^2+k
y_{1}~a(b)^x_{1}
y_{1}~a/x_{1}+b

Choose model based on question structure. When the question supplies the SAME
function in one form and asks about its coefficients in another form, fit the
two forms to each other instead (strategy 60).

LIST TRICKS

Paired x_{1} and y_{1} lists are the expression-row equivalent of a Desmos
table. Use them for points, function evaluation, comparisons, and regressions so
the app can load every required row automatically.

20. Test answer choices all at once with a list
[technique: answer-choice-list | Answer-choice list test]

Suppose choices are:

[2,4,6,8]

Define:

A=[2,4,6,8]

Then if:

f(x)=x^2-6x+8

enter:

f(A)

Desmos evaluates all choices.

Useful when you need to see which choice:

produces 0
produces a required value
satisfies a condition

Desmos lists can be used anywhere you'd normally use a single number.

21. Plug all answer choices into an equation
[technique: answer-choice-list | Answer-choice list test]

Instead of individually trying four values:

A=[5,7,9,11]

Then:

3A+2

or:

f(A)

Compare outputs.

This is great for multiple-choice questions.

22. Generate integer lists
[technique: integer-list-filter | Integer list filter]
[1...20]

generates:

1,2,3,...,20

You can also do:

[1,3...21]

for odd numbers.

Desmos officially supports this list syntax.

Useful for testing possible integer values quickly.

23. Function list instead of repeated substitution
[technique: list-evaluation | Evaluate over a list]

Define:

f(x)=2x^2-5x+7

Enter all requested inputs in a list:

X=[input values]

Then enter:

f(X)

Desmos returns all corresponding outputs in the same order.

Useful when comparing many values.

FUNCTIONS
24. Define the function once
[technique: function-evaluation | Function evaluation]

Instead of repeatedly typing:

2(7)^2-3(7)+5

enter:

f(x)=2x^2-3x+5

then:

f(7)

This becomes especially useful when the question asks multiple things about one function.

25. Function composition
[technique: function-evaluation | Function evaluation]

If:

f(x)=...
g(x)=...

then just enter:

f(g(3))

Let the function composition calculate the intermediate values.

26. Compare two functions
[technique: graph-both-sides | Graph both sides]

Enter:

f(x)=...
g(x)=...

Graph both.

Questions such as:

For what x is f(x)=g(x)?

→ intersection.

When is f(x)>g(x)?

→ see where f is above g.

INEQUALITIES
27. Graph inequalities directly
[technique: graph-inequality | Graph the inequality]

Enter:

y>2x+3

or:

x+y≤10

Desmos shades the valid region.

28. Systems of inequalities
[technique: graph-inequality | Graph the inequality]

Enter each inequality separately.

The overlapping shaded region = solution region.

Useful for questions asking which point satisfies all constraints.

29. Test a point visually
[technique: graph-inequality | Graph the inequality]

If answer choices are coordinate points and question asks which belongs to solution region:

Graph inequalities.

Look at which point lies in the overlap.

LINES / SLOPE
30. Find slope from two points directly
[technique: linear-regression | Linear regression]

Let regression calculate it from the two supplied points:

x_{1}=[x-coordinate 1,x-coordinate 2]
y_{1}=[y-coordinate 1,y-coordinate 2]
y_{1}~mx_{1}+b

Read m under Regression Parameters. This is preferred to recalling and typing:

(17-5)/(8-2)

The slope quotient is an acceptable candidate only when the formula is supplied
or the student is explicitly being tested on it and it requires no extra algebra.
31. Graph a line from standard form
[technique: graph-raw | Graph as written]

Don't convert:

3x+4y=24

Just type it.

Then click intercepts if needed.

32. Find x- and y-intercepts visually
[technique: intercept-read | Read the intercepts]

Graph:

3x+4y=24

Click:

x-axis crossing
y-axis crossing

No substitution required.

33. Parallel line
[technique: derivative-regression | Derivative regression]

When a line f is supplied and the requested parallel line g must pass through
(p,q), let Desmos fit both coefficients of g:

f(x)=the supplied line
g(x)=ax+b
[g'(0),g(p)]~[f'(0),q]

Read or graph g. This makes Desmos match the slopes and enforce the supplied
point without asking the student to calculate a slope or use point-slope form.
If f came from an earlier regression, freeze its displayed numeric equation
before this fit. Use implicit graphing or answer-choice testing for vertical lines.

34. Perpendicular line
[technique: derivative-regression | Derivative regression]

For a requested perpendicular line g through (p,q), fit the perpendicular-slope
condition and the point together:

f(x)=the supplied line
g(x)=ax+b
[g'(0)f'(0),g(p)]~[-1,q]

Desmos differentiates and fits a and b. The student does not calculate the
negative reciprocal or use point-slope form. Handle vertical/horizontal special
cases with implicit graphing or test the answer choices directly.

CIRCLES
35. Graph a circle directly
[technique: graph-raw | Graph as written]
(x-h)^2+(y-k)^2=r^2

Instantly reveals:

center (h,k)
radius r
36. Expanded circle equation → graph instead of completing square
[technique: expanded-circle | Expanded-circle regression]

Given:

x^2+y^2-6x+8y-11=0

just graph the equation.

You can visually determine the circle and often infer center/radius much faster than completing squares.

For an exact center/radius, do not estimate the picture or complete the square.
Fit the expanded equation to center-radius form at independent sample pairs:

x_{1}=[0,1,0,2,-1,3]
y_{1}=[0,0,1,2,3,-1]
x_{1}^2+y_{1}^2-6x_{1}+8y_{1}-11~(x_{1}-h)^2+(y_{1}-k)^2-q
\sqrt{q}

Read h and k as the center and the final row as the positive radius. Keep the
original coefficients in the regression; q represents r² and avoids a ±r fit.
Use enough independent (x,y) samples to identify the two linear coefficients and
constant term. Verify q is nonnegative and the fitted form is exactly equivalent.

Unknown constant in the circle equation (never complete the square by hand):
x^2+y^2-10x-8y-14n=0 is circle A; circle B shares its center, has twice the
diameter, and passes through (11,8); find n. The center does not depend on n,
so fit it once with the regression above (h=5, k=4, treating -14n as part of
the constant q). Then express the condition on the point: B's radius is twice
A's, so the point halfway from the center to (11,8) lies on A:

n=1        (slider, from -10 to 10, step 1)
x^2+y^2-10x-8y-14n=0
\operatorname{midpoint}((5,4),(11,8))

Drag n until the circle passes through the plotted midpoint (8,6); n=-2. A
deterministic alternative is one regression on that condition: with the
midpoint's coordinates entered, 8^2+6^2-10(8)-8(6)-14n~0 fits n=-2. If the
point is on circle A itself, skip the midpoint and drag n until the circle
passes through the point, or fit 11^2+8^2-10(11)-8(8)-14n~0. This is a
calculator plan; completing the square and solving for n by hand is a written
plan with hidden algebra and must not win.

37. Circle-line intersections
[technique: graph-both-sides | Graph both sides]

Graph both.

Click intersection.

Useful for coordinate geometry.

ABSOLUTE VALUE
38. Absolute-value equations
[technique: graph-both-sides | Graph both sides]

Given:

|2x-5|=9

Graph:

y=|2x-5|
y=9

Intersections are solutions.

Use these entries even for a simple equation; the intersections show both
solutions without splitting the absolute value into manual cases.

39. Absolute-value transformations
[technique: vertex-read | Click the vertex]

Graph:

y=a|x-h|+k

Vertex immediately gives:

(h,k)

Useful when identifying transformations or parameters.

EXPONENTIALS
40. Graph two exponential expressions
[technique: graph-both-sides | Graph both sides]

Question:

3(1.2)^x=15

Enter:

y=3(1.2)^x
y=15

Click intersection.

No logarithms required.

41. Exponential model from two/more points
[technique: exponential-regression | Exponential regression]

Paired x_{1} and y_{1} lists +:

y_{1}~a(b)^x_{1}

Then use a and b.

Very useful for growth/decay SAT problems.

PERCENT / WORD PROBLEMS
42. Turn the story directly into equations
[technique: story-system | Story to equations]

Example:

Adult tickets cost $12, student tickets cost $8.
140 tickets generated $1,400.

Enter:

x+y=140
12x+8y=1400

Use x for adult tickets and y for student tickets so Desmos graphs both equations.

Click intersection.

Read the requested ticket count from the intersection instead of eliminating
variables by hand.

If the question asks only which equation represents the story, stop before
graphing or solving. Write each quantity, combine them according to the words,
and simplify only enough to match a choice. Example:

ninth grade = n
tenth grade = 2n+18
total = 162

n+(2n+18)=162
3n+18=162

Choose that equation. Solving for n would not help identify the representation.

43. Mixture problems
[technique: story-system | Story to equations]

Example:

x+y=50
0.3x+0.7y=22

Graph.

Intersection.

44. Work/rate equations
[technique: graph-both-sides | Graph both sides]

Once translated, graph the relation instead of hand-solving complicated fractions.

Example:

1/x+1/6=1/4

could be solved by graphing each side.

Compare a direct numeric expression with graphing the original relation. Prefer
whichever needs less human mathematical knowledge or rearrangement; fewer
calculator rows is only a final tie-breaker.

STATISTICS
45. Mean
[technique: statistics-builtin | Statistics built-in]

For values:

L=[4,7,9,10,15]

use:

\operatorname{mean}(L)
46. Median
[technique: statistics-builtin | Statistics built-in]
\operatorname{median}(L)
47. Standard deviation
[technique: statistics-builtin | Statistics built-in]

Desmos has statistical functions, so use them when a problem directly requires numerical comparison rather than manually calculating deviation.

48. Weighted mean
[technique: statistics-builtin | Statistics built-in]

For integer group frequencies, let Desmos rebuild the data:

V=[85,92]
F=[20,30]
\operatorname{mean}(\operatorname{repeat}(V,F))

This avoids recalling a weighted-mean formula. For noninteger weights, use
\operatorname{total}(VF)/\operatorname{total}(F) and explain the weights; do not make the student derive a long
expanded numerator.

GEOMETRY
49. Distance formula directly
[technique: distance-builtin | distance() built-in]

Given points:

(x_{1},y_{1}), (x_{2},y_{2})

enter:

\operatorname{distance}((x_{1},y_{1}),(x_{2},y_{2}))

Use the Desmos built-in so the student does not need to recall the distance
formula. Preserve an exact radical in the final answer when required; do not
claim its rounded decimal is exact.

50. Midpoint directly
[technique: midpoint-builtin | midpoint() built-in]
\operatorname{midpoint}((x_{1},y_{1}),(x_{2},y_{2}))

Prefer the built-in to recalling two coordinate-average formulas.
51. Pythagorean theorem
[technique: reference-formula | Reference-sheet formula]

Enter:

\sqrt{c^2-a^2}

instead of doing arithmetic by hand.

The theorem is printed on the SAT reference sheet, so direct substitution into
Desmos is low-knowledge and fully acceptable.

52. Area/volume direct substitution
[technique: reference-formula | Reference-sheet formula]

If the question or SAT reference sheet provides the formula, enter it with the
given values. Reference-sheet examples include:

πr^2h

for cylinder volume, as well as circle/rectangle/triangle area and the listed
prism, sphere, cone, and pyramid volumes.

Do not create unnecessary algebra. For an unprovided niche formula such as a
custom surface-area or coordinate-geometry shortcut, first look for polygon,
distance, graphing, regression, or direct geometric construction in Desmos.

TRIG
53. Direct trig evaluation
[technique: trig-evaluation | Direct trig evaluation]

For:

\sin(θ)
\cos(θ)
\tan(θ)

The embedded calculator uses degrees to match the SAT testing calculator. If the
question explicitly uses radians, convert that input to degrees with *180/π or
switch the calculator setting and say so.

Critical: Don't mix radians and degrees.

54. Inverse trig to find an angle
[technique: inverse-trig | Inverse trig]

If:

\sin(\theta)=0.6

use:

\sin^{-1}(0.6)

The displayed angle is in degrees by default.

55. Right-triangle trig
[technique: right-triangle-trig | SOHCAHTOA]

Instead of doing several manual steps:

\theta=\tan^{-1}(opposite/adjacent)

or directly evaluate missing side expression.

SOHCAHTOA is a core SAT relationship, so this may beat a more elaborate graph
when the diagram makes the opposite/adjacent/hypotenuse roles immediate. Keep
the arithmetic in Desmos and do not introduce a rarer trig identity unnecessarily.

ANSWER-CHOICE ABUSE

These are important because SAT Math is often multiple choice.

56. Plug answer choices into original equation
[technique: answer-choice-list | Answer-choice list test]

If solving conventionally looks ugly, backsolve.

For choices:

A=[2,5,8,12]

evaluate original expression using A.

Whichever satisfies the condition wins.

57. Graph answer-choice constants, sliders, and graphical conditions
[technique: slider-condition | Slider until it fits]

Suppose question asks which could be k.

Try:

k=choice

or substitute choice into equation and observe:

intersections
roots
tangency
required behavior

Enter all choices as a list when the same test can be evaluated at once. Test
choices one at a time only when the required graph behavior cannot be vectorized.
Fewer keystrokes never outweigh a list method that removes manual comparison.

Sliders and graphical conditions are first-class methods, not fallbacks.
Trigger: a continuous or integer parameter must be found so that a graph shows
a condition: the curves touch (tangency), overlap (infinitely many solutions),
meet exactly once or never, share an intercept, a shaded region contains a
point, a vertex lands on an axis. Define the parameter as a slider row with a
starting value and a reasonable range, then graph the original relation:

k=0        (slider from -5 to 5, step 1)
y=\left|x-3\right|+k
y=2

The student drags k until the V-shape touches y=2 at exactly one point and
reads k=2 from the slider. Set the slider range from the question (integer
step for integer parameters; a range that contains every legal value). The
app applies the slider bounds you supply; without them Desmos uses -10..10.
A valid final instruction can be "drag k until the graphs share an
x-intercept; that happens at k=3" or "the fourth choice is the only one that
crosses the x-axis at the required point".

Do not slider-search blindly when a regression, a shared-zero setup, or a
deterministic list finds the same value directly; those are preferred. Use a
slider when the condition is visual and the parameter range is reasonable, or
to show WHY a fitted value works. Never present the slider's starting value as
the answer, and never define the slider at the answer itself.

58. Use the answer choices to narrow graph window
[technique: choice-window | Zoom to the choices]

If choices are around:

20–30

you don't care what happens at x=1000.

Zoom around expected values.

This saves time finding the right point.

SPECIAL HIGH-VALUE SAT TRICKS
59. Identity/coefficient questions → direct regression or strategic values
[technique: identity-regression | Identity regression]

High-priority trigger: A polynomial equation has unknown constants and is true
for all x, is an identity, or is stated to have infinitely many solutions.
Prefer entering the original equation as a regression to a multi-step
coefficient-matching solution.

Create a list of sample x-values, replace x by the list variable on BOTH sides,
and replace the equation's equals sign with a regression tilde. Parameters to
be fitted must stay undefined; do not make sliders or assign their answers first.

Example:

(12x+28)/4 - s/13 = r(x-8)

Enter these two rows:

x_{1}=[1...5]
(12x_{1}+28)/4 - s/13 ~ r(x_{1}-8)

Read s=403 and r=3 under Regression Parameters on the second row. No manual
coefficient matching or y-value table is necessary. If the question asks for
a combination of parameters, enter that combination as the next row.

For an affine identity, agreement at two distinct x-values determines the
coefficients; the five-value list supplies more than enough inputs here. For a
polynomial difference of degree at most d, use at least d+1 distinct valid inputs,
with enough independent information to determine the parameters. Verify the
returned constants against the original equation internally: both sides in this
example become 3x-24, so the identity holds and s>0.

Sample inputs are deterministic so a student can reproduce the setup: prefer
x_{1}=[1...5] or another small list that avoids excluded domain values over
random(). Keep inputs small when the identity has high powers (x^{14}); if the
expression repeats one power, such as z^{14} and z^{7}, let the list stand for
u=z^{7} so the identity is quadratic in u (strategy 72).

When the identity leaves a parameter free (fewer independent coefficient
equations than unknowns), Desmos still returns SOME branch. Do not report it as
unique. Use the stated constraints (positive, integer, noninteger, greatest or
least possible, a supplied answer list) to isolate the intended branch with a
justified candidate list or answer-choice testing, and report only the quantity
the givens determine (REGRESSION SAFETY below).

Do not present rounded RMSE=0 as proof for an arbitrary function. Avoid excluded
domain values, redundant/underdetermined parameters, and ambiguous nonlinear
fits. Infinitely many roots of a non-polynomial function (such as a periodic
function) do not by themselves make it an identity.

Strategic values are another candidate when they immediately remove a term:

Suppose:

a(x+3)+b(x-2)=5x+7

Instead of expanding everything, choose x-values that eliminate pieces.

For instance:

x=-3
x=2

You can evaluate both sides in Desmos.

This shortcut can be useful for a direct observation. For a multi-unknown
identity, prefer the two-row regression setup to a manual derivation.

60. Equivalent-form / identity regression between two forms
[technique: identity-regression | Identity regression]

Trigger: a function is given in one form and the question asks about a
constant or coefficient in an equivalent form: vertex form a(x-h)^2+k versus
standard form Ax^2+Bx+C, factored versus expanded, a rewritten rational or
exponential expression, or "which of the following is equivalent". Fit the two
forms to each other at deterministic sample inputs instead of expanding,
distributing, matching coefficients, or completing the square:

x_{1}=[1...5]
2(x_{1}-3)^2+5 ~ ax_{1}^2+bx_{1}+c

Read a, b, c (here 2, -12, 23). The unknown side may be either form:

x_{1}=[1...5]
3x_{1}^2-24x_{1}+50 ~ a(x_{1}-h)^2+k

gives h=4 and k=2, the vertex, with no completing the square. Use at least
d+1 distinct inputs for degree d, avoid excluded values, and state which fitted
parameter answers the question. If a parameter stays free (for example two
forms that agree for every choice of one constant), use the problem's
constraints or the answer choices rather than pretending the fit chose it.
(Three supplied points and an unknown quadratic remain strategy 18.)

61. Model parameters → regression instead of systems
[technique: parameter-regression | Parameter regression]

If the SAT gives several input/output values and asks for constants inside a model:

y=a(x-h)^2+k

or

y=a(b)^x

Tables or paired lists plus regression let Desmos infer the parameters without
requiring the student to construct and solve a system. Prefer that reduction in
human algebra even when a manually derived formula would use fewer entries.

Several equations with unknown constants → direct bracket regression
[technique: bracket-regression | Bracket regression]

High-priority trigger: two or more equations contain unknown coefficients or
constants, one or more coordinates or values are supplied, and the question
asks for one parameter. For two or three equations, copy the complete left sides
inside one pair of brackets and the complete right sides inside another, in the
same order. Replace = with ~. Desmos solves the conditions simultaneously.
Do not split a small system into separate coefficient lists: that adds typing
and bookkeeping without outsourcing any additional math.

-x-wy=-337 and 2x-wy=47 meet at (q,19):
[-q-19w,2q-19w]~[-337,47]

Desmos fits q=128 and w=11. Never enter -q-19w=-337 and 2q-19w=47 as graphs;
they contain no x or y and cannot be plotted (SYNTAX SAFETY).

7rx+12sy=3 and 3rx+4sy=5 with x=2, asked for r:
x_{1}=2
[7rx_{1}+12sy_{1},3rx_{1}+4sy_{1}]~[3,5]

Here s and y appear only as the product sy, so they are not individually
identifiable; read only r=3. The values shown for s and y_{1} are one possible
fit, not unique answers. If a redundant fit is numerically fragile, use the
compact, fully determined version [7r(2)+12p,3r(2)+4p]~[3,5], where p is sy.
Do not rebuild it using coefficient lists. A final r row is optional when it
helps read/verify the answer. Keep tables or coefficient lists when they are
actual data, have many observations, or serve other useful rows.
Report the requested parameter that the givens determine; never present
an arbitrary fitted value of a nuisance parameter as unique. If the requested
parameter itself is not identifiable from the givens, say so and use the
question's constraints or answer choices rather than the first branch.

Derivative regression for unknown parameters in parallel lines
[technique: derivative-regression | Derivative regression]

Use when one nonvertical line is given by readable points, another contains an
unknown coefficient, and the question requires parallel lines or no solutions.
Treat the derivative notation as a calculator command to match slopes, not as
a request for the student to differentiate or recall a slope formula.

Example: Line h goes through (-6,0) and (0,-9). Line k is sx+48y=t.
The system has no solution. Which t is NOT possible: -432, -9, 72, or 288?

One canonical eight-row setup (paired lists are table columns):

1. x_{1}=[-6,0]
   Enter the x-coordinates of the two marked points.
2. y_{1}=[0,-9]
   Enter the matching y-coordinates in the same order.
3. y_{1}~mx_{1}+b
   Let Desmos find the line through those points; leave m and b unassigned.
4. f(x)=-1.5x-9
   Copy or export the fitted equation displayed by row 3. This freezes the
   regression's exact coefficients; no slope calculation is required.
5. t=[-432,-9,72,288]
   Enter every answer choice in the supplied order.
6. g(x)=(-sx+t)/48
   Graph line k for all four choices; leave s unassigned for the next regression.
7. g'(0)~f'(0)
   Ask Desmos to match the lines' slopes and find s. The prime command performs
   the differentiation. Here the slopes are constant, so input 0 suffices.
8. g(0)-f(0)
   Compare the fitted parallel lines at x=0. A zero marks the choice whose line
   overlaps h instead of staying separate.

Read the final list in answer-choice order: its first entry is zero, so t=-432
(choice A) is NOT possible for a no-solution system. Parallel, separate lines
never meet; overlapping lines instead have infinitely many solutions. The fit
gives m=-1.5, b=-9, and s=72. Students copy the first fitted equation and let
the second regression determine s; they do not derive any of those results.

Important Desmos dependency rule: Do not use f(x)=mx+b here. A later regression
involving f can treat the earlier regression's m and b as free parameters and
refit them, producing duplicate-parameter errors or the wrong model. Before
chaining regressions, freeze the verified first fitted model by copying or
exporting its displayed coefficients into a numeric function, as row 4 does.
Copying an established regression result is permitted; assigning answers to
unknown parameters before their source fit is not. Preserve sufficient exact
precision when freezing coefficients; do not silently use rounded display
values that would change the answer. This example's -1.5 and -9 are exact.

[technique: slider-parallel | Slider until parallel]
The solver may prepare g's function form; explain it as the given line written
for Desmos, not as another student algebra task. Do not replace this approach
with manual slope calculation, s=-48m, and a hand-derived coincidence constant;
that hidden derivation costs more than the rows it saves. Under the total-effort
ranking, a five-row visual version is usually simpler and preferred: fit the
given line (rows 1–3), enter t=[-432,-9,72,288], then sx+48y=t with s=1 as a
slider; drag s until the four lines are parallel to the fitted line, and the
one that overlaps it is the impossible choice. Keep the eight-row derivative
regression as the deterministic alternative when the overlap is hard to see.

Validity limits: Two distinct x-coordinates determine the supplied nonvertical
line. This derivative fit has one identifiable unknown s, not two free line
parameters. t is a supplied answer list, not another parameter to fit. The
comparison at one x-value proves coincidence only AFTER equal constant slopes
have been established. A derivative match at one point does not establish
parallelism or identity for arbitrary curves. Handle vertical lines with
implicit graphing instead. Repeated equal derivatives are not independent new
observations. A rounded RMSE=0 or R²=1 alone is not a proof for an arbitrary
model, and graph overlap alone should not replace a numeric choice check when
choices are close together. Use a scalar input such as 0 for list-valued g;
do not accidentally zip lists of different lengths or create nested lists.

62. Complicated equation but simple graphical target
[technique: graph-raw | Graph as written]

If question asks:

What is a solution?

and equation is ugly:

Graph first.

Examples involving:

radicals
quadratics
exponentials
absolute values
rational expressions

The uglier the algebra, the more likely graphing wins.

63. “Which equation could represent this graph?”
[technique: graph-each-choice | Graph each choice]

Graph answer choices.

You can often eliminate choices immediately from:

slope
intercept
vertex
opening direction
asymptotes
roots
64. “Which graph represents this equation?”
[technique: graph-each-choice | Graph each choice]

Graph equation once and compare.

Use the plotted shape and key features to compare the supplied graph choices.

65. Integer brute force with list filtering
[technique: integer-list-filter | Integer list filter]

Use when:

- the variable must be an integer
- the possible range is reasonably bounded
- the problem asks which or how many integers satisfy a condition

Example:

N=[1...100]

N[3N+7<50]

For the number of solutions:

\operatorname{count}(N[3N+7<50])

Prefer this over manually solving and reasoning about integer endpoints when
Desmos can directly search the candidates. The list must be justified by the
problem: a stated bound, a positivity or digit condition, or a divisor list
such as the factor pairs of a constant term. Never use an arbitrary range like
[1...5] because the answer is "probably small"; if no bound is justified,
choose another method (regression, shared zero, answer-choice testing).

66. Frequency tables with repeat()
[technique: frequency-repeat | repeat() for frequencies]

Given:

V=[10,20,30]

F=[2,3,1]

Use:

\operatorname{repeat}(V,F)

Then:

\operatorname{mean}(\operatorname{repeat}(V,F))

\operatorname{median}(\operatorname{repeat}(V,F))

\operatorname{stdevp}(\operatorname{repeat}(V,F))

Use when values are supplied with frequencies. Let Desmos reconstruct the full
data set instead of manually computing a weighted statistic. Use stdev instead
of stdevp when the question explicitly asks for sample standard deviation.
The embedded calculator enables repeat(), which is disabled by default in the
general v1.11 API unless the host opts into it.

67. Minimum/maximum whole groups with ceil/floor
[technique: ceil-floor | ceil/floor for whole groups]

Trigger phrases:

- minimum number needed
- at least ___ people or items
- containers, packages, buses, or trips required
- maximum number of complete groups

Examples:

\operatorname{ceil}(437/48)

\operatorname{floor}(437/48)

Use ceil when a partial final group still requires another whole container,
vehicle, package, or trip. Use floor when only complete groups count.

68. Coordinate polygon area
[technique: polygon-area | polygon() area]

\operatorname{polygon}((1,2),(7,2),(4,8))

Use when coordinates of a polygon are given and the problem asks for area.

Prefer this when it avoids:

- the shoelace formula
- decomposing the figure
- finding base and height manually

Enter the vertices in boundary order so the polygon is traced correctly, then
read the area Desmos displays for the polygon.

69. Number-theory built-ins
[technique: number-theory-builtin | mod/gcd/lcm built-ins]

Use:

\operatorname{mod}(a,b)

\operatorname{gcd}(a,b)

\operatorname{lcm}(a,b)

when the question directly involves:

- remainders
- divisibility
- greatest common factor
- least common multiple
- repeating cycles

Enter the problem's given values directly and explain which displayed result
answers the question.

70. Repeated sums/products
[technique: sum-product | Sum/product notation]

Use Desmos sum or product notation when a question contains a long sequence
whose terms follow a simple rule.

Prefer this over requiring the student to know an arithmetic or geometric
series formula when Desmos can directly evaluate the terms. Define any sequence
rule and bounds explicitly, and check whether the endpoints are included.

71. Derivative as automatic slope finder
[technique: derivative-slope | Derivative slope finder]

Given:

f(x)=...

Use:

f'(x)

to let Desmos compute slopes automatically.

If a tangent must be parallel to slope m:

f'(x)=m

Read the x-value or x-values.

Do not require the student to differentiate manually. Apply any domain or
interval restriction from the question, and include all valid tangent points.

72. Factorization by identity regression
[technique: identity-regression | Identity regression]

Trigger: a polynomial is known to factor into parameterized factors, or the
question asks for a coefficient given a factored form: "can be written as
(2z^7+p)(17z^7+q)", "is equivalent to (x+a)(x+b)", "b is a constant and the
expression factors". Fit the original polynomial directly against the proposed
factorization instead of expanding, matching coefficients, or factoring by hand:

34z^14+bz^7+70 written as (2z^7+7)(17z^7+10), asked for b:
x_{1}=[1...5]
34x_{1}^2+bx_{1}+70 ~ (2x_{1}+7)(17x_{1}+10)

The list stands for u=z^7, which makes the identity quadratic in u and keeps
the numbers small; explain that substitution in one sentence. Desmos returns
b=139. Use at least degree+1 distinct deterministic inputs.

When the factorization leaves unknowns on both sides, the identity alone may
not determine them. For (2z^7+p)(17z^7+q) with p and q unknown, the identity
forces only pq=70 and b=2q+17p, so b is not unique and Desmos reports one
branch. Then enumerate the justified branches from the stated constraints
(positive integers p, q):

P=[1,2,5,7,10,14,35,70]
Q=70/P
2Q+17P

and read the value that satisfies the question (the one answer choice present,
the least, the greatest). Never assume the first regression branch is the
required one.

When BOTH coefficients in each factor are unknown integers and the question
asks for a maximum or minimum, one exact identity regression is especially
misleading: it only returns one factorization. For
12x^18+kx^9+35=(ax^9+b)(cx^9+d), the leading and constant products require
ac=12 and bd=35. Have Desmos search every signed divisor pair instead:

a_{1}=join([-12...-1],[1...12])
b_{1}=join([-35...-1],[1...35])
a_{2}=a_{1}[mod(12,a_{1})=0]
b_{2}=b_{1}[mod(35,b_{1})=0]
k_{1}=((p+q)(12/p+35/q)-12-35) for p=a_{2},q=b_{2}
max(k_{1})

The filter keeps exactly the possible integer a and b values. Desmos gets
c=12/a and d=35/b in the fifth row. At x^9=1, the product of the factors is
(a+b)(c+d), while the original is 12+k+35, so that row computes k for every
pair without expanding the factors. The final row returns 421. Include both
positive and negative divisors rather than guessing which signs maximize k.

73. Pack several conditions into one regression
[technique: bracket-regression | Bracket regression]

Trigger: several independent facts about one function with unknown constants:
roots, points, intercepts, a hole or vertical asymptote, equal outputs, a known
output, a stated value of f at some input. Translate every fact into a
numerical condition and fit them together as one list regression:

f(x)=(x^2+ax+b)/(x+c) with zeros at 5 and 6 and undefined at x=4:
f(x)=\frac{x^2+ax+b}{x+c}
[f(5),f(6),4+c]~[0,0,0]
a+b+c

Desmos fits a=-11, b=30, c=-4 at once; the last row reads the requested
combination (15). Translations: root at k → f(k)=0; point (p,q) → f(p)=q;
x-intercept → f(k)=0; y-intercept → f(0)=value; hole or vertical asymptote at
k → denominator(k)=0; equal outputs → f(a)-f(b)=0; known output → f(a)=value.
Supply as many independent conditions as unknowns; if fewer are available, the
fit is underdetermined and the extra freedom must come from the question's
constraints, not from whichever branch Desmos returned. Both sides of the
regression are lists of the same length; keep the condition order aligned.

74. Strategic-value testing for symbolic multiple choice
[technique: strategic-value-test | Strategic-value testing]

Trigger: the requested answer is an expression in a parameter (in terms of b,
in terms of k), the relationship is supposed to hold generally, and there are
finitely many answer choices. Choose one legal value for the parameter, let
Desmos compute the requested quantity numerically, and evaluate every choice at
that value:

f(x)=15b^x, asked for the percent increase per unit of x in terms of b:
b=1.5
f(x)=15b^x
\frac{f(1)-f(0)}{f(0)}100
[100(b-1),100b,100(1-b),b-1]

The computed 50 matches only the first entry, choice A. Rules: the chosen value
must satisfy every domain restriction in the question (b>1 for growth, b≠0,
integers if required); if two choices collide at the chosen value, test a
second legal value; several values may be needed. This is valid as finite
multiple-choice elimination and must be explained that way, never as a proof
of a general identity. Consider it before any niche symbolic formula.

75. Factor → shared zero
[technique: shared-zero | Shared zero]

High-priority trigger: "x+kb is a factor of", "which expression has a factor
of", "(x-a) is a factor", "divisible by". Avoid polynomial or synthetic
division. If x+2b is a factor, its zero is x=-2b, and the target polynomial
must also equal zero there. Let Desmos test that condition:

x+2b is a factor of 3x^2+25x+14b, b a positive integer, asked for b:
b=1        (integer slider, step 1, from 1 to 10)
y=x+2b
y=3x^2+25x+14b

Drag b until the line and the parabola share an x-intercept; that happens at
b=3. Nothing is derived: the factor and the polynomial are typed as given.
Deterministic alternative when the shared intercept is hard to see:
y=3(-2x)^2+25(-2x)+14x, where x stands for b (the factor's zero was
substituted into the target); read the positive zero, b=3. That substitution
is a small hidden step, so the slider version ranks first when the intercepts
are clear. Never derive a closed formula for b such as B=(M-7)/6 and type only
its result. With answer choices, evaluate the target at the shared zero for the
whole list: B=[choices], then 3(-2B)^2+25(-2B)+14B, and read the entry that is
zero. For "which expression has the factor", define the factor's zero once
and evaluate each candidate expression there; the one that returns zero has
the factor. Generalize to any linear factor px+q with zero x=-q/p. Prefer
regression, answer-choice testing, or a justified candidate list; never an
arbitrary brute-force range.

76. Exactly one intersection → vertex of the difference
[technique: vertex-of-difference | Vertex of the difference]

Trigger: a line and a parabola meet at exactly one point (tangent, one real
solution) and the unknown constant is added to one of them. Graph the
difference of the two sides with the unknown left out and click its vertex:

y=6x-k and y=3x^2+13x+2 meet exactly once, asked for k:
y=(3x^2+13x+2)-6x

The vertex is (-7/6,-25/12). The graphs meet once exactly when k cancels that
lowest value, so k=25/12. One row and one click replace the discriminant, a
derivative match, and the quadratic formula; flipping the sign of the clicked
value is the only arithmetic.

REGRESSION SAFETY

Regression is the highest-value tool in this library and the easiest to abuse.
Before accepting a fitted result, check: there are at least as many independent
conditions as unknowns; the requested parameter is identifiable even when a
nuisance parameter is not; no fitted parameter was assigned a value earlier in
the plan; no slider value is being mistaken for a solution; the returned branch
satisfies every sign, integer, and domain condition in the question; an identity
used at least degree+1 distinct inputs and avoided excluded values; and a
rounded RMSE=0 is not being read as proof for an underdetermined model. When
only the requested quantity is determined, report only that quantity. Use
deterministic sample inputs such as x_{1}=[1...5] rather than random() so the
student reproduces the same numbers; random() is acceptable only when the
randomness itself serves the mathematics.

MULTIPLICATION BY JUXTAPOSITION

Desmos multiplies values written next to each other, so drop the * and \cdot:
A(1+2)(1-8), 2x, mx_{1}+b, 3\sqrt{2}, (x+1)(x-2). A row full of stars looks
more complicated than the method actually is. Keep a star only where removing
it changes the meaning: between two numbers (2*3, since 23 is a different
number), before a signed value (x*-3, since x-3 is a subtraction), or directly
after a function name (f*(3), since f(3) calls the function). Reorder instead
where possible: 3x rather than x*3, 2(x+1) rather than (x+1)*2.

DESMOS-FIRST ROUTING

For each readable SAT Math question, consider every applicable approach below
and list every distinct technique that genuinely solves it, up to six. Leave out
inapplicable approaches rather than inventing data or a fake executable plan. Start by looking for:

1. Condition translation: convert every given fact (root, point, intercept,
   hole, factor, equivalent form, several equations, bounded domain) into a
   numerical condition, then regression, parameter regression, or derivative
   regression that lets Desmos infer the unknowns from those conditions.
2. Lists/tables and answer-choice testing that compare possibilities together,
   including strategic-value testing for symbolic choices.
3. Direct graphing of the original equations: intersections, zeros, intercepts,
   vertices, overlap, number of solutions, inequalities and shaded regions.
4. Sliders and graphical conditions: a parameter dragged until tangency, a
   shared intercept, overlap, or another visible condition appears (57).
5. Restricted-domain extrema and endpoint rows for bounded intervals (12).
6. Direct evaluation: function evaluation, integer-list filtering, frequency
   expansion, polygon area, number-theory functions, repeated sums/products,
   statistics, or direct calculations from the givens.
7. A written alternative only when its human reasoning can genuinely compete.

Do not ask only "how can Desmos calculate the answer?" Ask "how can Desmos make
the answer easiest for the student to obtain: by calculation, graph, slider, or
visual condition?"

Each listed technique must have a complete valid plan, not a renamed duplicate
of another listed technique. Report its cost components honestly (derivation
steps, one-off facts, primitives, setup constructions, manual iterations); the
server computes the total, and hand derivation and one-off facts cost the most.
Do not trade a lower-priority benefit for greater human mathematical effort.

Count prerequisites honestly. Remembering a slope formula, converting standard
form to identify its slope, knowing coefficient relationships, or selecting a
non-obvious substitution all cost human knowledge even if the final arithmetic
is typed into Desmos. A formula generated by the solver still needs explanation
if the student must understand or recreate it. Count that burden; do not hide it
inside a numeric calculator row. An unfamiliar Desmos command can be taught as
an entry and purpose without requiring the student to perform its algebra or
calculus manually. Prefer the method students can reproduce from the givens.

Rows are worthwhile only when they simplify the whole workflow. A few extra
rows that remove a derived slope or coefficient formula are worth it; rows
that automate what the graph already shows, re-check a labeled point, or turn
a two-row intersection into a list construction are not. The simplest valid
applicable method beats a more elaborate one; among methods of equal
simplicity, the one with less total student effort wins, then the one with
less manual math, then fewer rows. Do not fill rows with checks to make the
outsourcing score look higher; outsourcing is only a tie-breaker.

Easy solving and evaluation questions can still use Desmos; the representation
exception above still applies. For 3x=18, the original graphs y=3x and y=18
let the student read the intersection without deciding to divide first. Compare
that with 18/3 and account for its inverse-operation knowledge. Similarly,
y=x+7 and y=12 avoid manually isolating x. Graphing y=x²-9 exposes both roots.
A direct 0.2*80 or pi*5² may be suitable when the conversion or formula is given
or requires no greater human knowledge than alternatives. Preserve exact units
and values; a rounded calculator decimal is not automatically an exact answer.

Do not enter only 6, x=6, or another precomputed result and describe it as solving
with Desmos. Regression unknowns remain unassigned until the fit; invented
observations cannot justify a model. Internally verify the chosen answer against
the original question, including signs, domains, all possible roots, and words
such as NOT or EXCEPT. Do not show the internal verification as another strategy.

WRITTEN FALLBACKS

List a paper technique as an alternative whenever one genuinely solves the
problem; it becomes the default only when its total cost is genuinely lowest.
Consider every relevant calculator category above first. An easy problem, an
exact answer, a familiar formula, or fewer written steps does not by itself
justify a fallback. A necessary conceptual instruction can accompany useful
calculator rows without replacing the selected calculator method.

Legitimate limitations include:
- The target is a conceptual interpretation, such as what a model's intercept
  means in its story, and no numeric calculation answers that interpretation.
- The target is the equation/expression representing a story, and direct
  translation already identifies it; solving the chosen model is outside the
  requested task and does not validate its meaning.
- The question asks for a general symbolic claim or proof that testing a few
  values or viewing a graph cannot establish, and no reliable SAT shortcut
  provides the requested conclusion through the calculator.
- Every valid calculator approach requires more human mathematical knowledge or
  manual algebra than a direct conceptual observation, after considering the
  advanced methods. More calculator entries alone is not such a limitation.

State the specific limitation for this question in one short sentence. Do not
use a generic "algebra is faster" excuse. Give only the necessary written steps.
Missing or unreadable data requires clarification, never a guessed fallback.

OUTPUT CONTRACT

Each listed technique is a separate, complete method; never mix two techniques
inside one plan. Each row's purpose explains that exact row, and the final
instruction tells the student which output to read and how it answers this
question. Derive each explanation from its technique's ordered entries, never
from a separate algebra solution. Only a written technique leaves the calculator
empty.
