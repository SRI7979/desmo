import AccountNav from "@/components/account-nav";
import { requireUser } from "@/lib/auth";
import { Atkinson_Hyperlegible } from "next/font/google";
import SolverWorkspace from "./solver-workspace";

const solverFont = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-solver",
});

export const dynamic = "force-dynamic";
export const metadata = { title: "Solver | Desmo", robots: { index: false, follow: false } };

export default async function SolverPage() {
  const user = await requireUser("/solve");
  return (
    <div className={solverFont.variable}>
      <SolverWorkspace
        accountNav={<AccountNav email={user.email} active="solve" />}
      />
    </div>
  );
}
