/* eslint-disable @next/next/no-img-element -- the logo mark is cropped with CSS positioning that next/image would change. */
import Link from 'next/link'
import { ArrowUpRight, Plus } from 'lucide-react'
import { ProductPersonalization } from './landing-demo'

const QUESTIONS = [
  ['What does Desmo do?', 'Upload a screenshot of one SAT Math question. Desmo reads it, finds the Desmos way to solve it, and puts each line into the Desmos calculator, with a plain explanation of what every line does and how to read the answer.'],
  ['Do I need an account?', 'Yes. Sign in with Google or email. Your solved problems are saved to History, and the tricks you save stay in Saved tricks.'],
  ['What is the difference between the Desmos way and the math way?', 'The Desmos way lets the calculator do the work: graphs, regressions, sliders, and lists. If it still needs a small step by hand, Desmo names it. The math way is the paper method, like the quadratic formula. Desmo recommends the Desmos way and lists the math way beside it.'],
  ['Is Desmo made by Desmos?', 'No. Desmo is an independent project. The solver embeds the Desmos graphing calculator; Desmo is not affiliated with or endorsed by Desmos.'],
  ['Is there a limit on solves?', 'Each account has a daily limit on new solves. Problems you have already solved stay available in History.'],
  ['Will my appearance choices be saved?', 'Light or dark mode is remembered on this device. Your palette and style choices stay set for the rest of your browser session.'],
  ['Can I use it on mobile?', 'Yes. On a phone, the solver switches between the explanation and the calculator with tabs.'],
] as const

export function LandingDetails() {
 return <>
  <ProductPersonalization/>
  <section className="landing-faq refined-faq" id="questions"><div><span className="section-index">03 / GOOD TO KNOW</span><h2>A few details.</h2></div><div>{QUESTIONS.map(([q,a])=><details key={q}><summary>{q}<Plus size={16}/></summary><p>{a}</p></details>)}</div></section>
  <section className="quiet-cta"><div><span className="section-index">LESS ALGEBRA. MORE DESMOS.</span><h2>Find your next “I get it.”</h2></div><Link href="/solve" className="landing-cta">Solve a question <ArrowUpRight size={17}/></Link></section>
  <footer className="site-footer"><div className="footer-top"><div className="footer-brand"><Link href="/" className="landing-logo"><span className="provided-mark" aria-hidden="true"><img src="/images/desmo-logo-source.png" alt=""/></span>desmo</Link><p>Desmos-first help for SAT Math.</p><span className="prototype-label">Independent project · Not affiliated with Desmos</span></div><div><h3>Product</h3><Link href="/solve">Solver</Link><Link href="/history">History</Link><Link href="/tricks">Saved tricks</Link><a href="#preview">How it works</a></div><div><h3>Resources</h3><a href="#questions">Questions</a><a href="https://www.desmos.com/calculator" target="_blank" rel="noreferrer">Desmos calculator ↗</a><a href="https://github.com/SRI7979" target="_blank" rel="noreferrer">Contact developer ↗</a></div><div><h3>Project</h3><a href="#project-notices">Attribution & licenses</a><a href="#how-desmo-works">How Desmo works</a><a href="https://www.desmos.com/privacy" target="_blank" rel="noreferrer">Desmos privacy ↗</a></div></div>
   <div className="footer-notices" id="project-notices"><details><summary>Attribution & third-party licenses <Plus size={14}/></summary><p>Desmo is independent of Desmos. Desmos retains ownership of its calculator and trademarks. Open-source software used here includes <a href="https://github.com/facebook/react/blob/main/LICENSE">React (MIT)</a>, <a href="https://github.com/vercel/next.js/blob/canary/license.md">Next.js (MIT)</a>, <a href="https://github.com/KaTeX/KaTeX/blob/main/LICENSE">KaTeX (MIT)</a>, and <a href="https://lucide.dev/license">Lucide (ISC)</a>. Their respective licenses apply.</p></details><details id="how-desmo-works"><summary>How Desmo works <Plus size={14}/></summary><p>When you upload a screenshot, Desmo sends it to an AI model to read the question and propose ways to solve it. Every Desmos line runs in a hidden calculator before you see it, and a line that errors is never shown. Your solved problems are saved to your account’s History. The embedded calculator is provided by Desmos and is subject to Desmos’s policies.</p></details></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Desmo.</span><span>Less algebra. More Desmos.</span><a href="#top">Back to top ↑</a></div>
  </footer>
 </>
}
