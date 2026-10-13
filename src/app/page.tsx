import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

export const metadata: Metadata = {
  title: "Desmo — Desmos-first SAT Math",
  description: "Upload a screenshot of an SAT Math question. Desmo finds the Desmos way to solve it, puts every line in the Desmos calculator, and explains each one.",
};

export default function Page() {
  return <Landing />;
}
