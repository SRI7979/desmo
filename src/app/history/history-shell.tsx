import DesmoLogo from "@/components/desmo-logo";
import type { ReactNode } from "react";
import AccountNav from "@/components/account-nav";
import workspace from "@/app/solve/page.module.css";
import { WorkspaceAppearance } from "@/components/appearance-provider";

export default function HistoryShell({ email, avatarUrl, name, active = "history", children }: { email?: string; avatarUrl?: string; name?: string; active?: "history" | "tricks" | "settings"; children: ReactNode }) {
  return (
    <WorkspaceAppearance className={workspace.shell}>
      <header className={workspace.header}>
        <DesmoLogo variant="workspace" />
        <AccountNav email={email} avatarUrl={avatarUrl} name={name} active={active} />
      </header>
      <main className={`${workspace.main} ${workspace.historyMain}`}>{children}</main>
    </WorkspaceAppearance>
  );
}
