import DesmoLogo from "@/components/desmo-logo";
import type { ReactNode } from "react";
import AccountNav from "@/components/account-nav";
import workspace from "@/app/solve/page.module.css";

export default function HistoryShell({ email, avatarUrl, active = "history", children }: { email?: string; avatarUrl?: string; active?: "history" | "tricks" | "settings"; children: ReactNode }) {
  return (
    <div className={workspace.shell}>
      <header className={workspace.header}>
        <DesmoLogo />
        <AccountNav email={email} avatarUrl={avatarUrl} active={active} />
      </header>
      <main className={workspace.main}>{children}</main>
    </div>
  );
}
