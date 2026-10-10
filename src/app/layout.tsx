import type { Metadata } from "next";
import type { ReactNode } from "react";
import ThemeProvider from "@/components/theme-provider";
import AppearanceProvider from "@/components/appearance-provider";
import { workspaceFonts } from "@/components/workspace-fonts";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./solve/solver-ui.css";

const themeInit = `(()=>{try{const value=localStorage.getItem("desmo-theme");const dark=value==="dark"||(value==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=dark?"dark":"light"}catch{document.documentElement.dataset.theme="light"}})()`;

export const metadata: Metadata = {
  title: "Desmo",
  description:
    "Solve SAT Math questions with Desmos and clear, step-by-step explanations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={workspaceFonts} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body><ThemeProvider><AppearanceProvider>{children}</AppearanceProvider></ThemeProvider></body>
    </html>
  );
}
