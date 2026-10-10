"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import { NEW_PROBLEM_EVENT } from "@/lib/workspace-events";
import DesmoLogo from "./desmo-logo";
import { AppearanceStudio, AppearanceThemeToggle } from "./appearance-studio";
import styles from "./account-nav.module.css";

type View = "solve" | "history" | "tricks" | "settings";
type IconName = "solve" | "history" | "tricks" | "plus";

const links: { href: string; label: string; view: View; icon: IconName }[] = [
  { href: "/solve", label: "Solver", view: "solve", icon: "solve" },
  { href: "/history", label: "History", view: "history", icon: "history" },
  { href: "/tricks", label: "Saved tricks", view: "tricks", icon: "tricks" },
];

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "solve" && <><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /><path d="m8 12 2.5 2.5L16 9" /></>}
      {name === "history" && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>}
      {name === "tricks" && <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4z" />}
      {name === "plus" && <path d="M12 5v14M5 12h14" />}
    </svg>
  );
}

function AccountMenu({ email, avatarUrl, name, active, placement }: { email?: string; avatarUrl?: string; name?: string; active: View; placement: "sidebar" | "header" }) {
  const [open, setOpen] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const openedOnHoverOrFocus = useRef(false);
  const displayName = name || email?.split("@")[0] || "Account";
  const avatarInitial = name
    ? name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
    : email?.trim().charAt(0).toUpperCase();
  const menuId = "account-menu-" + placement;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) {
        openedOnHoverOrFocus.current = false;
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  return (
    <div
      ref={accountRef}
      className={[styles.account, placement === "sidebar" ? styles.sidebarAccount : styles.headerAccount].join(" ")}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") {
          openedOnHoverOrFocus.current = true;
          setOpen(true);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          openedOnHoverOrFocus.current = false;
          setOpen(false);
        }
      }}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          openedOnHoverOrFocus.current = true;
          setOpen(true);
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          openedOnHoverOrFocus.current = false;
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          openedOnHoverOrFocus.current = false;
          setOpen(false);
          accountRef.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button
        type="button"
        className={styles.avatarButton}
        aria-label={`${displayName} account menu`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (openedOnHoverOrFocus.current) {
            openedOnHoverOrFocus.current = false;
            setOpen(true);
          } else {
            setOpen((current) => !current);
          }
        }}
      >
        <span className={styles.avatar} aria-hidden="true">
          {avatarUrl && !photoFailed ? (
            // Google's OAuth profile image uses a remote host outside image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className={styles.avatarImage} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
          ) : avatarInitial || (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" focusable="false">
              <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5.25 20c.6-3.3 3-5 6.75-5s6.15 1.7 6.75 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </span>
        {placement === "sidebar" && <span className={styles.accountName} title={displayName}>{displayName}</span>}
      </button>
      <div id={menuId} className={styles.menu} aria-label="Account options" hidden={!open}>
        {email ? (
          <>
            <div className={styles.identity}>
              <strong>{displayName}</strong>
              <span title={email}>{email}</span>
            </div>
            <Link href="/settings" aria-current={active === "settings" ? "page" : undefined} onClick={() => setOpen(false)}>Settings</Link>
            <form action={signOut}><button type="submit">Sign out</button></form>
          </>
        ) : <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>}
      </div>
    </div>
  );
}

export default function AccountNav({ email, avatarUrl, name, active }: { email?: string; avatarUrl?: string; name?: string; active: View }) {
  const title = active === "solve" ? "Solver" : active === "history" ? "History" : active === "tricks" ? "Saved tricks" : "Settings";
  return (
    <div className={styles.root}>
      <aside className={styles.desktopSidebar} aria-label="Workspace sidebar">
        <div className={styles.sidebarBrand}><DesmoLogo variant="workspace" /></div>
        <a
          className={styles.newProblem}
          href="/solve"
          onClick={(event) => {
            // On the solver, start over in place instead of reloading the page and Desmos.
            if (active !== "solve") return;
            event.preventDefault();
            window.dispatchEvent(new Event(NEW_PROBLEM_EVENT));
          }}
        >
          <Icon name="plus" />New problem
          {active === "solve" && <kbd className={styles.shortcut} aria-label="Shortcut: N">N</kbd>}
        </a>
        <nav className={styles.sidebarLinks} aria-label="Main navigation">
          <span className={styles.sidebarLabel}>Workspace</span>
          {links.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active === item.view ? "page" : undefined}>
              <Icon name={item.icon} />{item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.sidebarFooter}><AccountMenu email={email} avatarUrl={avatarUrl} name={name} active={active} placement="sidebar" /></div>
      </aside>

      <div className={styles.breadcrumb}><span>Workspace</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
      <div className={styles.headerActions}>
        <AppearanceThemeToggle />
        <AppearanceStudio />
        <AccountMenu email={email} avatarUrl={avatarUrl} name={name} active={active} placement="header" />
      </div>
      <nav className={styles.mobileNavigation} aria-label="Main navigation">
        {links.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.view ? "page" : undefined}>
            <Icon name={item.icon} /><span>{item.label === "Saved tricks" ? "Tricks" : item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
