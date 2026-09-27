import katex from "katex";

/** Display the same LaTeX string passed to Desmos, without regenerating it. */
export default function MathExpression({ latex }: { latex: string }) {
  const html = katex.renderToString(latex, {
    throwOnError: false,
    strict: "ignore",
    trust: false,
    maxSize: 10,
    maxExpand: 1000,
    output: "htmlAndMathml",
  });

  // Only KaTeX's escaped, untrusted-input-safe output is inserted as HTML.
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
