import AccountNav from "@/components/account-nav";
import { requireUser } from "@/lib/auth";
import SolverWorkspace from "./solver-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Solver | Desmo", robots: { index: false, follow: false } };

export default async function SolverPage() {
  const user = await requireUser("/solve");
  return <SolverWorkspace accountNav={<AccountNav email={user.email} avatarUrl={user.avatarUrl} name={user.name} active="solve" />} />;
}
