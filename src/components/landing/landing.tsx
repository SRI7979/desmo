/* eslint-disable @next/next/no-img-element -- the logo mark is cropped with CSS positioning that next/image would change. */
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { LandingDemo } from './landing-demo'
import { LandingDetails } from './landing-details'
import './landing-reset.css'
import './landing.css'
import './landing-refinements.css'

export function Landing() {
  return <div className="desmo-landing" id="top">
    <section className="landing-top">
      <Image className="horizon-art" src="/images/desmo-starlit-coast.png" fill priority unoptimized sizes="100vw" alt="" />
      <header className="landing-nav"><Link href="/" className="landing-logo" aria-label="Desmo home"><span className="provided-mark" aria-hidden="true"><img src="/images/desmo-logo-source.png" alt=""/></span>desmo</Link><nav aria-label="Main navigation"><a href="#preview">How it works</a><a href="#experience">Your workspace</a><a href="#questions">Questions</a></nav><Link className="nav-cta" href="/solve">Open solver <ArrowUpRight size={15}/></Link></header>
      <main className="landing-hero"><div className="hero-kicker"><span/>DESMOS-FIRST SAT MATH</div><h1>Make the hard part<br /><em>make sense.</em></h1><p>Upload a screenshot of an SAT Math question.<br className="desktop-break"/> Desmo finds the Desmos way to solve it and explains every line.</p><div className="hero-actions"><Link href="/solve" className="landing-cta">Solve a question <ArrowRight size={17}/></Link></div><span className="hero-footnote">Sign in with Google or email to start</span></main>
      <a className="hero-scroll" href="#preview">See how it works <span aria-hidden="true">↓</span></a>
    </section>
    <div className="landing-content"><LandingDemo/><LandingDetails/></div>
  </div>
}
