import DesmoLogo from "@/components/desmo-logo";
import type { ReactNode } from "react";
import AccountNav from "@/components/account-nav";
import workspace from "@/app/solve/page.module.css";

export default function HistoryShell({ email, children }: { email?: string; children: ReactNode }) {
  return (
    <div className={workspace.shell}>
      <header className={workspace.header}>
        <DesmoLogo />
        <AccountNav email={email} active="history" />
      </header>
      <main className={workspace.main}>{children}</main>
    </div>
  );
}
