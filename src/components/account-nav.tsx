"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import styles from "./account-nav.module.css";

export default function AccountNav({
  email,
  avatarUrl,
  active,
}: {
  email?: string;
  avatarUrl?: string;
  active: "solve" | "history" | "tricks" | "settings";
}) {
  const [open, setOpen] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const openedOnHoverOrFocus = useRef(false);
  const avatarInitial = email?.trim().charAt(0).toUpperCase();

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
    <nav className={styles.nav} aria-label="Main navigation">
      <Link href="/solve" aria-current={active === "solve" ? "page" : undefined}>Solver</Link>
      <Link href="/history" aria-current={active === "history" ? "page" : undefined}>History</Link>
      <Link href="/tricks" aria-current={active === "tricks" ? "page" : undefined}>
        <span className={styles.fullLabel}>Saved tricks</span><span className={styles.shortLabel}>Tricks</span>
      </Link>
      <div
        ref={accountRef}
        className={styles.account}
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
          aria-label="Account menu"
          aria-expanded={open}
          aria-controls="account-menu"
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
              // Google's OAuth profile image uses a remote host that is not part of app image optimization.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className={styles.avatarImage} referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} />
            ) : avatarInitial || (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" focusable="false">
                <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
                <path d="M5.25 20c.6-3.3 3-5 6.75-5s6.15 1.7 6.75 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </span>
        </button>
          <div id="account-menu" className={styles.menu} aria-label="Account options" hidden={!open}>
            {email ? (
              <>
                <div className={styles.identity}>
                  <span>Signed in as</span>
                  <strong title={email}>{email}</strong>
                </div>
                <Link href="/settings" aria-current={active === "settings" ? "page" : undefined} onClick={() => setOpen(false)}>Settings</Link>
                <form action={signOut}><button type="submit">Sign out</button></form>
              </>
            ) : <Link href="/login" onClick={() => setOpen(false)}>Sign in</Link>}
          </div>
      </div>
    </nav>
  );
}
