import type { Metadata } from "next";
import type { ReactNode } from "react";
import ThemeProvider from "@/components/theme-provider";
import "katex/dist/katex.min.css";
import "./globals.css";

const themeInit = `(()=>{try{const value=localStorage.getItem("desmo-theme");const dark=value==="dark"||(value!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=dark?"dark":"light"}catch{document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}})()`;

export const metadata: Metadata = {
  title: "Desmo",
  description:
    "Solve SAT Math questions with Desmos and clear, step-by-step explanations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
