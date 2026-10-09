import { Geist, Geist_Mono, STIX_Two_Text } from "next/font/google";
import AccountNav from "@/components/account-nav";
import { requireUser } from "@/lib/auth";
import SolverWorkspace from "./solver-workspace";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const stix = STIX_Two_Text({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-stix" });

export const dynamic = "force-dynamic";
export const metadata = { title: "Solver | Desmo", robots: { index: false, follow: false } };

export default async function SolverPage() {
  const user = await requireUser("/solve");
  return <SolverWorkspace fontClassName={`${geist.variable} ${geistMono.variable} ${stix.variable}`} accountNav={<AccountNav email={user.email} avatarUrl={user.avatarUrl} name={user.name} active="solve" />} />;
}
