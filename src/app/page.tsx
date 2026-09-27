import Image from "next/image";
import Link from "next/link";
import DesmoLogo from "@/components/desmo-logo";
import styles from "./page.module.css";

function Arrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <DesmoLogo />
        <Link href="/solve" className={styles.secondaryButton}>
          Open solver <Arrow />
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1>Less algebra.<br /><span>More Desmos.</span></h1>
          <p>Upload an SAT Math question.<br className={styles.mobileBreak} /> Learn how to use Desmos to solve it.</p>
          <Link href="/solve" className={styles.primaryButton}>
            Try it <Arrow />
          </Link>
        </section>

        <section className={styles.preview} aria-labelledby="preview-label">
          <p id="preview-label" className={styles.previewLabel}>Worked example · Intersections</p>
          <div className={styles.previewBody}>
            <div className={styles.question}>
              <h3>Question</h3>
              <div className={styles.givens}>
                <div><i>y</i> = <i>x</i><sup>2</sup> − 4<i>x</i> + 1</div>
                <div><i>y</i> = 2<i>x</i> + 8</div>
              </div>
              <p>The graphs intersect at two points. What is the positive x-coordinate of an intersection?</p>
              <ol className={styles.choices} aria-label="Answer choices">
                <li><span>A</span> 5</li>
                <li><span>B</span> 6</li>
                <li className={styles.correctChoice}>
                  <span>C</span> 7
                  <span className={styles.check} aria-label="Correct answer">✓</span>
                </li>
                <li><span>D</span> 8</li>
              </ol>
              <div className={styles.answer}>
                <strong>Read the intersection.</strong>
                <p>The point is (7, 22), so the answer is <b>C. 7</b>.</p>
              </div>
            </div>
            <div className={styles.calculator}>
              <h3>Desmos solution</h3>
              <ol className={styles.entries} aria-label="Desmos expressions">
                <li>
                  <span className={styles.lineNumber}>1</span>
                  <div>
                    <span className={styles.equation}><i>y</i> = <i>x</i><sup>2</sup> − 4<i>x</i> + 1</span>
                    <span className={styles.purpose}>Graph the parabola</span>
                  </div>
                  <span className={styles.blueDot} aria-hidden="true" />
                </li>
                <li>
                  <span className={styles.lineNumber}>2</span>
                  <div>
                    <span className={styles.equation}><i>y</i> = 2<i>x</i> + 8</span>
                    <span className={styles.purpose}>Graph the line</span>
                  </div>
                  <span className={styles.purpleDot} aria-hidden="true" />
                </li>
              </ol>
              <Image
                src="/desmos-preview.png"
                alt="Desmos graph of y = x² − 4x + 1 and y = 2x + 8, with the positive intersection labeled (7, 22)."
                width={720}
                height={540}
                sizes="(max-width: 720px) calc(100vw - 40px), 580px"
                className={styles.graph}
                loading="eager"
                draggable={false}
              />
            </div>
          </div>
        </section>

        <section className={styles.why} aria-labelledby="why-heading">
          <div className={styles.whyIntro}>
            <h2 id="why-heading">Built around the calculator.</h2>
            <p className={styles.whySub}>
              Desmo turns a screenshot into a method you can use on test day.
              You see the entries, the reason for each one, and where to read the answer.
            </p>
          </div>
          <div className={styles.whyGrid}>
            <div className={styles.whyCard}>
              <span className={styles.whyIndex}>01</span>
              <div><h3>Choose the method</h3><p>Desmo compares graphing, regression, lists, and shortcuts for the question in front of you.</p></div>
            </div>
            <div className={styles.whyCard}>
              <span className={styles.whyIndex}>02</span>
              <div><h3>Let Desmos do the work</h3><p>The calculator fills in the selected entries, so you can focus on what they show.</p></div>
            </div>
            <div className={styles.whyCard}>
              <span className={styles.whyIndex}>03</span>
              <div><h3>Know what to read</h3><p>Each line and the final result are explained so you can repeat the method.</p></div>
            </div>
          </div>
        </section>
      </main>
      <footer className={styles.footer}><span>Desmo</span><span>Less work. More understanding.</span></footer>
    </div>
  );
}
